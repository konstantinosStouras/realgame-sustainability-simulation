import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const notice = { hidden: true, textContent: '' }, root = { innerHTML: 'Existing workspace' }, dialog = { open: false }, browser = {}, values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const body = { closest: () => null }, document = { activeElement: body, hidden: false, querySelector: key => ({ '#app': root, '#dialog': dialog, '#connection': notice })[key], addEventListener() {} };
  const context = vm.createContext({ document, localStorage: storage, sessionStorage: storage, URL, AbortSignal,
    location: { hostname: 'localhost' }, firebaseConfig: {}, classroomBackend: '', setTimeout: () => 1, clearTimeout() {}, setInterval() {},
    window: { addEventListener: (event, callback) => { browser[event] = callback; } } });
  vm.runInContext(app.split('\nawait startWorkspace();')[0], context);
  vm.runInContext(app.split('\nawait startWorkspace();')[1], context);
  const run = code => vm.runInContext(code, context), reads = [];
  context.testRead = path => new Promise((resolve, reject) => reads.push({ path, resolve, reject }));
  run("globalThis.renders = 0; render = () => { renders++; }; ensureSessionUpdates = () => {}; api = testRead; backend = 'https://classroom.invalid'; sessionId = 'class-a'; state = {revision:1, status:'paused'}; actor = {id:'student-a',role:'student'}; user = actor;");
  const reply = (index, revision = 2) => reads[index].resolve({ state: { revision, status: 'paused' }, actor: { id: 'student-a', role: 'student' } });
  return { notice, root, dialog, browser, values, document, body, context, run, reads, reply };
}

test('offline event immediately announces stale data without replacing or focusing the current draft', () => {
  const h = harness(), form = { value: 'Unsaved decision' }, input = { closest: () => form };
  h.document.activeElement = input;
  const markup = h.run('connectionNotice()');
  assert.match(markup, /id="connection".*role="status".*aria-live="polite"/); assert.match(markup, /hidden/);
  h.browser.offline();
  assert.equal(h.notice.hidden, false); assert.match(h.notice.textContent, /may be out of date/);
  assert.equal(h.document.activeElement, input); assert.equal(form.value, 'Unsaved decision'); assert.equal(h.run('renders'), 0);
  assert.equal(h.root.innerHTML, 'Existing workspace'); assert.equal(h.run('online'), false);
});

test('online event fetches current state but never resubmits a saved uncertain decision', async () => {
  const h = harness(), saved = '{"key":"unknown-response","revision":1,"command":{"type":"deposit"}}';
  h.values.set('studio-pending:https://classroom.invalid:student-a:class-a', saved);
  h.browser.offline(); h.browser.online(); await flush();
  assert.equal(h.notice.hidden, false, 'browser online alone cannot confirm recovery');
  assert.deepEqual(h.reads.map(read => read.path), ['/sessions/class-a']);
  h.reply(0); await flush();
  assert.equal(h.notice.hidden, true); assert.equal(h.notice.textContent, ''); assert.equal(h.run('state.revision'), 2);
  assert.equal(h.values.get('studio-pending:https://classroom.invalid:student-a:class-a'), saved);
});

test('successful reconnect while editing clears connection warning while retaining reviewed state, draft and focus', async () => {
  const h = harness(), form = { value: 'Draft amount' }, input = { closest: () => form };
  h.document.activeElement = input; h.browser.offline(); h.browser.online(); await flush();
  h.reply(0); await flush();
  assert.equal(h.notice.hidden, true); assert.equal(h.run('online'), true);
  assert.equal(h.run('state.revision'), 1); assert.equal(h.run('refreshDeferred'), true);
  assert.equal(h.document.activeElement, input); assert.equal(form.value, 'Draft amount'); assert.equal(h.run('renders'), 0);
  h.document.activeElement = h.body;
  const refresh = h.run('refreshInBackground()'); await flush(); h.reply(1); await refresh;
  assert.equal(h.run('state.revision'), 2); assert.equal(h.run('refreshDeferred'), false);
});

test('failed reconnect keeps the warning until an authoritative view succeeds', async () => {
  const h = harness(); h.browser.offline(); h.browser.online(); await flush();
  h.reads[0].reject(new Error('Server unavailable')); await flush();
  assert.equal(h.notice.hidden, false); assert.equal(h.run('online'), false); assert.equal(h.run('renders'), 0);
  const retry = h.run('load(false)'); h.reply(1, 1); await retry;
  assert.equal(h.notice.hidden, true); assert.equal(h.run('online'), true);
});

test('pre-offline responses cannot clear a newer offline warning', async () => {
  const h = harness(), pending = h.run('load(false)');
  h.browser.offline(); h.reply(0); await pending;
  assert.equal(h.notice.hidden, false); assert.equal(h.run('online'), false); assert.equal(h.run('state.revision'), 1);
  h.browser.online(); await flush(); h.reply(1); await flush();
  assert.equal(h.notice.hidden, true); assert.equal(h.run('state.revision'), 2);
});

test('late view callbacks cannot change connection or data in another session, backend, account or auth identity', async () => {
  for (const change of ["sessionId = 'class-b'", "backend = 'https://other.invalid'", "user = {id:'student-b'}", "firebaseClient = {user:{uid:'other-auth'}}", "preview = 'company-b'"]) {
    for (const fail of [false, true]) {
      const h = harness(), pending = h.run('load(false)');
      h.run(change);
      if (fail) h.reads[0].reject(new Error('Old connection failed')); else h.reply(0, 99);
      await pending;
      assert.equal(h.run('state.revision'), 1, change); assert.equal(h.notice.hidden, true, change); assert.equal(h.run('online'), true, change);
    }
  }
});

test('direct API network failure shows a plain-language notice without replacing an open dialog', async () => {
  const h = harness(); h.dialog.open = true;
  h.run(app.slice(app.indexOf('async function api('), app.indexOf('async function connectBackend(')));
  h.context.fetch = async () => { throw new Error('Network unavailable'); };
  await assert.rejects(h.run("api('/sessions/class-a/command', {key:'pending-key'})"), error => {
    assert.match(error.message, /retry that same decision/); assert.doesNotMatch(error.message, /local server|local URL|localhost|browser may restrict/i); return true;
  });
  assert.equal(h.notice.hidden, false); assert.equal(h.dialog.open, true); assert.equal(h.run('renders'), 0);
});

test('an obsolete direct API failure cannot mark a newer successful view offline', async () => {
  const h = harness(); let reject;
  h.run(app.slice(app.indexOf('async function api('), app.indexOf('async function connectBackend(')));
  h.context.fetch = () => new Promise((resolve, fail) => { reject = fail; });
  const old = h.run("api('/sessions/class-a')");
  h.run('loadSequence++; online = true;');
  reject(new Error('Old request failed')); await assert.rejects(old);
  assert.equal(h.notice.hidden, true); assert.equal(h.run('online'), true);
});

test('connection events ignore local solo and temporary classrooms', async () => {
  for (const mode of ['solo = {}', 'testRoom = {}', 'state = null']) {
    const h = harness(); h.run(mode); h.browser.offline(); h.browser.online(); await flush();
    assert.equal(h.notice.hidden, true); assert.equal(h.reads.length, 0); assert.equal(h.run('online'), true);
  }
});

test('a replaced account subscription cannot refresh or close the new account workspace', async () => {
  const h = harness(), watchers = [];
  h.context.watchSession = options => { watchers.push(options); return { stop() {}, healthy: true }; };
  h.run(app.slice(app.indexOf('function ensureSessionUpdates('), app.indexOf('const submittingForms')));
  h.run("health = {sessionUpdates:true}; firebaseClient = {user:{uid:'auth-a'},token:async ()=>'token-a'}; globalThis.closed = 0; clearClosedSession = () => { closed++; }; ensureSessionUpdates();");
  h.run("user = {id:'student-b'}; firebaseClient = {user:{uid:'auth-b'},token:async ()=>'token-b'}; ensureSessionUpdates();");
  assert.equal(watchers.length, 2);
  await watchers[0].changed(); watchers[0].closed();
  assert.equal(h.reads.length, 0); assert.equal(h.run('closed'), 0);
  watchers[1].closed(); assert.equal(h.run('closed'), 1);
});
