import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { watchSession } from '../src/session-updates.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').split('\nawait startWorkspace();')[0];
function harness() {
  const storage = {getItem:()=>null, setItem(){}, removeItem(){}};
  const dialog = {open:false};
  const document = {hidden:false, activeElement:{closest:()=>null}, querySelector:selector=>selector === '#dialog' ? dialog : {}, addEventListener(){}};
  const context = vm.createContext({document, localStorage:storage, sessionStorage:storage, location:{hostname:'localhost'}, setTimeout, clearTimeout, URL, AbortSignal, firebaseConfig:{}, classroomBackend:''});
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  const requests = [];
  context.respond = () => new Promise(resolve => requests.push(resolve));
  run("api = respond; render = () => {}; ensureSessionUpdates = () => {}; sessionId = 'test'; state = {revision:1,status:'paused'};");
  const reply = (i, revision) => requests[i]({state:{revision,status:'paused'},actor:{id:'student',role:'student'}});
  return {run,context,document,dialog,requests,reply};
}

test('120 simultaneous background notifications share one read and one trailing refresh', async () => {
  const h = harness(), first = h.run('refreshInBackground()');
  await flush(); assert.equal(h.requests.length, 1);
  const pending = Array.from({length:120}, () => h.run('refreshInBackground()'));
  assert.ok(pending.every(task => task === first));
  assert.equal(h.requests.length, 1);
  h.reply(0, 2); await flush(); assert.equal(h.requests.length, 2);
  h.reply(1, 121); await Promise.all([first,...pending]);
  assert.equal(h.run('state.revision'), 121);
  assert.equal(h.run('pendingLoads'), 0);
  assert.equal(h.run('backgroundRefresh'), null);
});

test('background refresh waits for an existing foreground read instead of invalidating it', async () => {
  const h = harness(), foreground = h.run('load(true)'), background = h.run('refreshInBackground()');
  await flush(); assert.equal(h.requests.length, 1);
  h.reply(0, 2); await foreground; await flush();
  assert.equal(h.run('state.revision'), 2);
  assert.equal(h.requests.length, 2);
  h.reply(1, 3); await background;
  assert.equal(h.run('state.revision'), 3);
});

test('navigation cancels a queued background read for the previous classroom', async () => {
  const h = harness(), foreground = h.run('load(true)'), background = h.run('refreshInBackground()');
  await flush(); h.run("sessionId = 'another-class';");
  h.reply(0, 2); await Promise.all([foreground,background]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.run('state.revision'), 1);
});

test('healthy paused subscriptions suppress polling while running and fallback states retain it', () => {
  const h = harness();
  h.run("liveSession = {id:'test',watch:{healthy:true}};");
  assert.equal(h.run('needsBackgroundPoll()'), false);
  for (const setup of ["state.status = 'running'", 'online = false', 'refreshDeferred = true', 'liveSession.watch.healthy = false', "liveSession.id = 'old'"]) {
    h.run("state.status = 'paused'; online = true; refreshDeferred = false; liveSession = {id:'test',watch:{healthy:true}};" + setup);
    assert.equal(h.run('needsBackgroundPoll()'), true, setup);
  }
  h.document.hidden = true;
  assert.equal(h.run('needsBackgroundPoll()'), false);
});

test('a paused change deferred while editing is fetched after the draft closes', async () => {
  const h = harness(); h.run("liveSession = {id:'test',watch:{healthy:true}};");
  h.dialog.open = true;
  const background = h.run('refreshInBackground()'); await flush();
  h.reply(0, 2); await background;
  assert.equal(h.run('state.revision'), 1);
  assert.equal(h.run('refreshDeferred'), true);
  assert.equal(h.run('needsBackgroundPoll()'), false);
  h.dialog.open = false;
  assert.equal(h.run('needsBackgroundPoll()'), true);
  const retry = h.run('refreshInBackground()'); await flush(); h.reply(1, 2); await retry;
  assert.equal(h.run('state.revision'), 2);
  assert.equal(h.run('needsBackgroundPoll()'), false);
});

test('session watcher awaits the changed view before starting another long poll', async () => {
  const urls = []; let release, changed = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const watch = watchSession({url:'https://invalid/updates', token:async()=>'synthetic', revision:1,
    changed:async()=>{ changed++; await gate; }, closed(){},
    fetcher:async url => { urls.push(url); return {ok:true,status:200,json:async()=>urls.length===1 ? {revision:2} : {closed:true}}; }
  });
  assert.equal(watch.healthy, false);
  await flush(); assert.equal(changed, 1); assert.equal(urls.length, 1); assert.equal(watch.healthy, true);
  release(); await watch.task;
  assert.equal(urls.length, 2); assert.equal(new URL(urls[1]).searchParams.get('revision'), '2'); assert.equal(watch.healthy, false);
});

test('a failed view callback retries its revision and marks the watcher unhealthy', async () => {
  const urls = []; let rejected;
  const failed = new Promise(resolve=>{ rejected=resolve; });
  const watch = watchSession({url:'https://invalid/updates',token:async()=>'synthetic',revision:1,
    changed(){ rejected(); throw new Error('View unavailable'); },closed(){},
    fetcher:async url=>{urls.push(url);return {ok:true,status:200,json:async()=>urls.length===1?{revision:2}:{closed:true}};}
  });
  await failed; await flush(); assert.equal(watch.healthy, false);
  await watch.task; assert.equal(urls.length,2); assert.equal(new URL(urls[1]).searchParams.get('revision'), '1');
});

test('120 clients and their unchanged reconnects use independent long-poll URLs at the same revision', async () => {
  const urls = [], waits = new Set(); let changed = 0, closed = 0;
  const watches = Array.from({length:120}, (_, i) => {
    let calls = 0;
    return watchSession({url:'https://invalid/updates', token:async()=>`synthetic-${i}`, revision:17,
      changed(){ changed++; }, closed(){ closed++; },
      fetcher:async (url, options) => {
        urls.push(url); const parsed = new URL(url);
        assert.equal(parsed.searchParams.get('revision'), '17');
        assert.deepEqual([...parsed.searchParams.keys()], ['revision','wait']);
        assert.match(parsed.searchParams.get('wait'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        waits.add(parsed.searchParams.get('wait'));
        assert.equal(options.headers.Authorization, `Bearer synthetic-${i}`);
        assert.equal(options.cache, 'no-store');
        assert.ok(!url.includes('synthetic'));
        calls++;
        return {ok:true,status:200,json:async()=>calls===1 ? {revision:17} : {closed:true}};
      }
    });
  });
  await Promise.all(watches.map(watch=>watch.task));
  assert.equal(urls.length,240); assert.equal(new Set(urls).size,240); assert.equal(waits.size,240);
  assert.equal(changed,0); assert.equal(closed,120);
});
