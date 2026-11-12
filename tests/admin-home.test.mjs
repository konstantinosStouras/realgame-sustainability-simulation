import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').split("\nawait startWorkspace();")[0];
function setup(role) {
  const root = {}, values = new Map();
  const storage = { getItem: k => values.get(k), setItem: (k,v) => values.set(k,v) };
  const context = vm.createContext({ document: { querySelector: s => s === '#app' ? root : {}, addEventListener() {} },
    localStorage: storage, sessionStorage: storage, URL, Blob, location: { hostname: 'localhost', href: 'http://localhost/' }, classroomBackend: '', FEATURES: [],
    role, opened: 0, sampleSessions: [{id:'active-code',name:'Class <one>',status:'paused',hour:0},{id:'past-code',name:'Old class',status:'completed',hour:72}] });
  vm.runInContext(source, context);
  vm.runInContext("api = async () => ({user:{name:'Test instructor',role},sessions:sampleSessions}); load = async () => { opened++; };", context);
  return {root,context,run: code => vm.runInContext(code,context)};
}
test('instructor login opens session management without fetching a company workspace', async () => {
  const h=setup('instructor'); await h.run('enter()');
  assert.equal(h.context.opened,0);
  assert.match(h.root.innerHTML,/Active sessions/);
  assert.match(h.root.innerHTML,/Past sessions/);
  assert.match(h.root.innerHTML,/Class &lt;one&gt;/);
  assert.doesNotMatch(h.root.innerHTML,/workspace-tools/);
  assert.equal(h.run('sessionId'),null);
});
test('explicit session selection opens controls while student login still opens the classroom', async () => {
  for(const role of ['instructor','student']) {
    const h=setup(role);await h.run(role==='instructor' ? 'enter(true)' : 'enter()');
    assert.equal(h.context.opened,1);assert.equal(h.run('sessionId'),'active-code');
  }
});
test('account actions are role-aware and theme slot precedes the name', () => {
  const h=setup('student');const html=h.run("accountControls({name:'Student <name>',role:'student'})");
  assert.ok(html.indexOf('data-theme-slot')<html.indexOf('account-menu'));
  assert.match(html,/Student &lt;name&gt;/);assert.match(html,/Join a company/);
  assert.doesNotMatch(html,/Create a session|Student directory/);
});

test('creation form offers familiar cities and a separate custom ID', () => {
 const h=setup('instructor');const html=h.run('createSessionFields()');
 assert.match(html,/name="sessionCity"/);assert.match(html,/value="london"/);
 assert.match(html,/name="customSessionId"/);assert.match(html,/data-custom-session hidden/);
 assert.match(html,/name="name"/);assert.match(html,/session-setup/);
});
