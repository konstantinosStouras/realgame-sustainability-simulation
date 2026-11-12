import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as engine from '../src/engine.mjs';
const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').split('\nawait startWorkspace();')[0];
function setup(values = new Map(), { id = 'teacher', sessionId = 'class-one', unavailable = false } = {}) {
  const session = engine.createSession({ id: sessionId });
  const teacher = { id, role: 'instructor', name: 'Test instructor' };
  engine.applyCommand(session, teacher, { type: 'step', hours: 48 });
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => { if(unavailable) throw new Error('Storage blocked'); values.set(k,v); } };
  const root = { innerHTML: '' }, requests = [];
  const location = { hostname: 'localhost', href: 'https://example.test/simulation/?session=' + sessionId };
  const context = vm.createContext({ ...engine, URL, location, history: { replaceState: (_,__,href) => { location.href=href; } },
    localStorage: storage, sessionStorage: storage, classroomBackend: '', firebaseConfig: {},
    document: { querySelector: s => s === '#app' ? root : { open: false }, addEventListener() {}, activeElement: { closest: () => null } },
    testApi: async path => { requests.push(path); if(path === '/me') return {user:teacher,sessions:[{id:sessionId}]}; const url=new URL(path,'https://example.test'); return {actor:teacher,state:engine.publicView(session,teacher,url.searchParams.get('company'))}; }
  });
  vm.runInContext(source,context); vm.runInContext('api = testApi;',context);
  return { values, root, requests, run: code => vm.runInContext(code,context) };
}

test('refresh restores every instructor page and company preview before the first state request', async () => {
  for(const page of ['overview','orders','supply','production','finance','energy','reports','messages','admin']) {
    for(const preview of page === 'admin' ? [null] : [null,'company-1','company-2','company-3']) {
      const original=setup(); await original.run('enter()');
      await original.run(`page=${JSON.stringify(page)}; preview=${JSON.stringify(preview)}; awaitLoad = load();`);
      await original.run('awaitLoad');
      const refreshed=setup(original.values); await refreshed.run('enter()');
      assert.equal(refreshed.run('page'),page);
      assert.equal(refreshed.run('preview') || null,preview);
      assert.equal(refreshed.requests.length,2,'only /me and the selected view are fetched');
      assert.equal(refreshed.requests[1],'/sessions/class-one'+(preview?'?company='+preview:''));
      assert.doesNotMatch(refreshed.root.innerHTML,/firebase-login-form/);
    }
  }
});

test('refresh retains report and conversation selections without caching classroom data', async () => {
  const original=setup();await original.run('enter()');
  original.run("page='reports'; report='emissions'; reportRange=7; selectedCompanies=new Set(['company-2']); channel='teacher:company-2'; render();");
  const refreshed=setup(original.values);await refreshed.run('enter()');
  assert.equal(refreshed.run('report'),'emissions');assert.equal(refreshed.run('reportRange'),7);
  assert.equal(refreshed.run('[...selectedCompanies].join()'),'company-2');
  assert.equal(refreshed.run('channel'),'teacher:company-2');
  const stored=[...original.values.values()].join();assert.doesNotMatch(stored,/cash|messages|token|Test instructor/);
});

test('view preferences do not cross accounts or sessions', async () => {
  const original=setup();await original.run('enter()');original.run("page='reports';preview='company-2';rememberInstructorView();");
  for(const options of [{id:'another-teacher'},{sessionId:'another-class'}]) {
    const other=setup(original.values,options);await other.run('enter()');
    assert.equal(other.run('page'),'admin');assert.equal(other.run('preview'),undefined);
  }
});

test('invalid preferences and unavailable storage cannot break classroom loading', async () => {
  const original=setup();await original.run('enter()');const key=original.run('instructorViewKey()');
  for(const value of ['{invalid', JSON.stringify({version:1,page:'__proto__',report:'invalid',preview:'removed-company',channel:'unknown',reportRange:-1,selectedCompanies:['removed-company']})]) {
    const values=new Map([[key,value]]);const refreshed=setup(values);await refreshed.run('enter()');
    assert.equal(refreshed.run('page'),'admin');assert.equal(refreshed.run('preview'),undefined);
    assert.equal(refreshed.run('report'),'profit');assert.equal(refreshed.run('selectedCompanies.size'),0);
  }
  const blocked=setup(new Map(),{unavailable:true});await blocked.run('enter()');assert.match(blocked.root.innerHTML,/Set the pace of learning/);
});
