import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as engine from '../src/engine.mjs';
const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').split('\nawait startWorkspace();')[0];
test('every instructor and student page renders from current state without network calls', () => {
  const session = engine.createSession();
  const teacher = { id: 'teacher', role: 'instructor', name: 'Test instructor' };
  engine.applyCommand(session, teacher, { type: 'step', hours: 72 });
  let count = 0;
  const started = performance.now();
  for (const role of ['instructor', 'student']) {
    const root = { innerHTML: '' };
    const storage = { getItem: () => null };
    const context = vm.createContext({ ...engine, document: { querySelector: s => s === '#app' ? root : {}, addEventListener() {} }, localStorage: storage, sessionStorage: storage, URL, location: { hostname: 'localhost', href: 'http://localhost/' }, classroomBackend: '', firebaseConfig: {}, fetch() { throw new Error('Navigation must not fetch'); } });
    vm.runInContext(source, context);
    const actor = role === 'instructor' ? teacher : { id: 'student', role, name: 'Test student', companyId: session.companies[0].id };
    context.currentActor = actor;
    context.currentState = engine.publicView(session, actor);
    vm.runInContext('actor = currentActor; user = actor; state = currentState; sessionId = state.id;', context);
    const pages = role === 'instructor' ? ['overview', 'admin', 'reports', 'messages'] : ['overview', 'orders', 'supply', 'production', 'finance', 'energy', 'reports', 'messages', 'workspace'];
    for (const page of pages) {
      context.targetPage = page;
      vm.runInContext('page = targetPage; render();', context);
      assert.match(root.innerHTML, /id="content"/);
      assert.doesNotMatch(root.innerHTML, /firebase-login-form|Loading your workspace|NaN/);
      count++;
    }
  }
  console.log(`Rendered ${count} role/page combinations in ${Math.round(performance.now() - started)} ms (synthetic data; excludes browser layout and network).`);
});
