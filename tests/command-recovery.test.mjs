import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as engine from '../src/engine.mjs';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';

const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').split('\nawait startWorkspace();')[0];
const storage = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) }; };
function client({ state, actor, saved = storage(), backend = 'https://classroom.invalid' }) {
  const pendingNotice = { isConnected: false, remove() { this.isConnected = false; } };
  const root = { querySelector: () => ({ insertAdjacentHTML: (_, html) => { if (html.includes('id="pending-decision"')) pendingNotice.isConnected = true; } }) }, dialog = { open: false }, notices = {}, handlers = {};
  const document = { activeElement: { closest: () => null }, addEventListener: (event, handler) => { handlers[event] = handler; },
    querySelector: key => ({ '#app': root, '#dialog': dialog, '#toast': notices, '#pending-decision': pendingNotice.isConnected ? pendingNotice : null })[key] || null };
  const context = vm.createContext({ ...engine, document, sessionStorage: saved, localStorage: storage(), URL, AbortSignal,
    crypto: { randomUUID }, setTimeout: () => 1, clearTimeout() {}, firebaseConfig: {}, classroomBackend: backend,
    location: { hostname: 'classroom.invalid', href: backend + '/?session=' + state.id }, currentState: state, currentActor: actor });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run('state = currentState; actor = currentActor; user = actor; sessionId = state.id; globalThis.actualRender = render; render = () => {}; ensureSessionUpdates = () => {};');
  const connect = api => { context.testApi = api; run('api = testApi;'); };
  return { run, context, connect, saved, notices, document, handlers, dialog, pendingNotice };
}
async function classroom() {
  const store = new FirestoreStore(new MemoryFirestore());
  const teacher = { id: 'teacher', role: 'instructor', name: 'Teacher' }, student = { id: 'student-a', role: 'student', name: 'Student A' }, peer = { id: 'student-b', role: 'student', name: 'Student B' };
  const state = await store.create(teacher, { id: 'class-a' });
  const invite = (await store.roster(teacher, state.id)).invites[0];
  await store.join(student, invite.code); await store.join(peer, invite.code);
  const view = who => store.view(who, state.id);
  const api = who => (path, request) => path.endsWith('/command') ? store.command(who, state.id, request) : view(who);
  return { store, teacher, student, peer, state, view, api };
}
const deposit = { type: 'deposit', amount: 10000, weeks: 1 };
const pendingKeys = saved => [...saved.values.keys()].filter(key => key.startsWith('studio-pending:'));

test('accepted response lost, then page refresh and exact retry creates one deposit and one debit', async () => {
  const f = await classroom(), original = client(await f.view(f.student)), requests = [];
  original.connect(async (path, request) => {
    if (!path.endsWith('/command')) return f.view(f.student);
    requests.push(structuredClone(request)); await f.store.command(f.student, f.state.id, request); throw new Error('Response lost after commit');
  });
  await assert.rejects(original.run(`command(${JSON.stringify(deposit)})`), /Response lost/);
  const accepted = await f.view(f.student), refreshed = client({ ...accepted, saved: original.saved });
  refreshed.connect(async (path, request) => { if (request) requests.push(structuredClone(request)); return f.api(f.student)(path, request); });
  await refreshed.run("action('retry-decision', '')");
  assert.deepEqual(requests[1], requests[0], 'same request key, original revision and command survive reload');
  assert.equal(pendingKeys(original.saved).length, 0);
  const result = await f.view(f.student);
  assert.equal(result.state.company.deposits.length, 1);
  assert.equal(result.state.company.accounts.cash, accepted.state.company.accounts.cash);
  assert.equal(result.state.revision, accepted.state.revision);
});

test('request lost before acceptance then competing decision forces review before a new retry', async () => {
  const f = await classroom(), original = client(await f.view(f.student));
  original.connect(async () => { throw new Error('Offline before send'); });
  await assert.rejects(original.run(`command(${JSON.stringify(deposit)})`), /Offline/);
  const old = JSON.parse(original.saved.getItem(pendingKeys(original.saved)[0]));
  await f.store.command(f.peer, f.state.id, { key: randomUUID(), revision: 0, command: { type: 'budget', research: 100, marketing: 100 } });
  const refreshed = client({ ...await f.view(f.student), saved: original.saved }), requests = [];
  refreshed.connect(async (path, request) => { if (request) requests.push(structuredClone(request)); return f.api(f.student)(path, request); });
  await assert.rejects(refreshed.run("action('retry-decision', '')"), error => error.status === 409);
  assert.deepEqual(requests[0], old); assert.equal((await f.view(f.student)).state.company.deposits.length, 0);
  assert.equal(pendingKeys(original.saved).length, 0);
  await refreshed.run(`command(${JSON.stringify(deposit)})`);
  assert.notEqual(requests[1].key, old.key); assert.equal(requests[1].revision, 1);
  assert.equal((await f.view(f.student)).state.company.deposits.length, 1);
});

test('two independently reviewed competing clients never silently overwrite a stale decision', async () => {
  const f = await classroom(), a = client(await f.view(f.student)), b = client(await f.view(f.peer));
  a.connect(f.api(f.student)); b.connect(f.api(f.peer));
  await a.run("command({type:'budget', research:11100, marketing:22200})");
  await assert.rejects(b.run("command({type:'budget', research:33300, marketing:44400})"), error => error.status === 409);
  assert.equal(b.run('state.company.research'), 11100);
  assert.equal((await f.view(f.student)).state.company.marketing, 22200);
  await b.run("command({type:'budget', research:33300, marketing:44400})");
  assert.equal((await f.view(f.student)).state.company.research, 33300);
});

test('saved unknown outcomes are isolated by account, session and backend', async () => {
  const f = await classroom(), initial = await f.view(f.student), a = client(initial);
  a.connect(async () => { throw new Error('Offline'); });
  await assert.rejects(a.run(`command(${JSON.stringify(deposit)})`));
  const oldKey = pendingKeys(a.saved)[0], old = a.saved.getItem(oldKey);
  for (const change of [ { actor: { ...initial.actor, id: 'different-user' } }, { state: { ...initial.state, id: 'class-b' } }, { backend: 'https://other.invalid' } ]) {
    const b = client({ ...initial, ...change, saved: a.saved }); let submitted = 0;
    b.connect(async (path, request) => { if (request) { submitted++; return { message: 'Saved' }; } return { ...initial, ...change }; });
    await b.run("action('retry-decision', '')"); assert.equal(submitted, 0);
    await b.run("command({type:'budget', research:100, marketing:200})"); assert.equal(submitted, 1);
    assert.equal(a.saved.getItem(oldKey), old);
  }
});

test('accepted but unconfirmed decision retains its exact retry key through temporary revoked access', async () => {
  const f = await classroom(), a = client(await f.view(f.student));
  a.connect(async (path, request) => { await f.store.command(f.student, f.state.id, request); throw new Error('Response lost after commit'); });
  await assert.rejects(a.run(`command(${JSON.stringify(deposit)})`));
  const key = pendingKeys(a.saved)[0], saved = a.saved.getItem(key);
  await f.store.command(f.teacher, f.state.id, { key: randomUUID(), revision: 1, command: { type: 'configure', studentAccess: false } });
  a.connect(f.api(f.student));
  await assert.rejects(a.run("action('retry-decision', '')"), error => error.status === 403);
  assert.equal(a.saved.getItem(key), saved, 'authorization loss cannot prove the original decision was rejected');
  await f.store.command(f.teacher, f.state.id, { key: randomUUID(), revision: 2, command: { type: 'configure', studentAccess: true } });
  const resumed = client({ ...await f.view(f.student), saved: a.saved }); resumed.connect(f.api(f.student));
  await resumed.run("action('retry-decision', '')");
  assert.equal((await f.view(f.student)).state.company.deposits.length, 1);
  assert.equal(pendingKeys(a.saved).length, 0);
});

test('authentication expiry preserves an accepted unknown response for exact retry after sign-in', async () => {
  const f = await classroom(), a = client(await f.view(f.student));
  a.connect(async (path, request) => { await f.store.command(f.student, f.state.id, request); throw new Error('Response lost after commit'); });
  await assert.rejects(a.run(`command(${JSON.stringify(deposit)})`));
  const key = pendingKeys(a.saved)[0], saved = a.saved.getItem(key);
  a.connect(async () => { throw Object.assign(new Error('Sign in required'), { status: 401 }); });
  await assert.rejects(a.run("action('retry-decision', '')"), error => error.status === 401);
  assert.equal(a.saved.getItem(key), saved, 'a rejected authentication refresh says nothing about the original commit');
  const signedIn = client({ ...await f.view(f.student), saved: a.saved }); signedIn.connect(f.api(f.student));
  await signedIn.run("action('retry-decision', '')");
  assert.equal((await f.view(f.student)).state.company.deposits.length, 1);
  assert.equal(pendingKeys(a.saved).length, 0);
});

test('a not-found response to an uncertain retry preserves the original receipt identity', async () => {
  const f = await classroom(), a = client(await f.view(f.student));
  a.connect(async (path, request) => { await f.store.command(f.student, f.state.id, request); throw new Error('Response lost after commit'); });
  await assert.rejects(a.run(`command(${JSON.stringify(deposit)})`));
  const key = pendingKeys(a.saved)[0], saved = a.saved.getItem(key);
  a.connect(async () => { throw Object.assign(new Error('Session unavailable'), { status: 404 }); });
  await assert.rejects(a.run("action('retry-decision', '')"), error => error.status === 404);
  assert.equal(a.saved.getItem(key), saved);
  const recovered = client({ ...await f.view(f.student), saved: a.saved }); recovered.connect(f.api(f.student));
  await recovered.run("action('retry-decision', '')");
  assert.equal((await f.view(f.student)).state.company.deposits.length, 1);
});

test('first-attempt authentication, permission and not-found rejections do not strand new decisions', async () => {
  for (const status of [401, 403, 404]) {
    const f = await classroom(), a = client(await f.view(f.student));
    a.connect(async () => { throw Object.assign(new Error('Definitive first-attempt rejection'), { status }); });
    await assert.rejects(a.run(`command(${JSON.stringify(deposit)})`), error => error.status === status);
    assert.equal(pendingKeys(a.saved).length, 0, String(status));
    a.connect(f.api(f.student));
    await a.run("command({type:'budget', research:100, marketing:200})");
    assert.equal((await f.view(f.student)).state.company.research, 100);
    assert.equal((await f.view(f.student)).state.company.deposits.length, 0);
  }
});

test('stale pending retry clears its rendered notice when reload already fetched the same current revision', async () => {
  for (const editing of [false, true]) {
    const f = await classroom(), original = client(await f.view(f.student));
    original.connect(async () => { throw new Error('Offline before send'); });
    await assert.rejects(original.run(`command(${JSON.stringify(deposit)})`));
    await f.store.command(f.peer, f.state.id, { key: randomUUID(), revision: 0, command: { type: 'budget', research: 100, marketing: 200 } });
    const reloaded = client({ ...await f.view(f.student), saved: original.saved });
    reloaded.connect(f.api(f.student)); reloaded.run('actualRender(); globalThis.renders = 0; render = () => { renders++; };');
    assert.equal(reloaded.pendingNotice.isConnected, true);
    const draft = { value: 'Still editing' }, focused = { closest: () => editing ? draft : null };
    reloaded.document.activeElement = focused; reloaded.dialog.open = editing;
    await assert.rejects(reloaded.run("action('retry-decision', '')"), error => error.status === 409);
    assert.equal(reloaded.run('state.revision'), 1);
    assert.equal(pendingKeys(original.saved).length, 0);
    assert.equal(reloaded.pendingNotice.isConnected, false, 'resolved notice disappears without requiring another revision');
    assert.equal(reloaded.run('renders'), 0, 'notice cleanup does not replace the current workspace');
    assert.equal(reloaded.document.activeElement, focused); assert.equal(draft.value, 'Still editing'); assert.equal(reloaded.dialog.open, editing);
    assert.equal((await f.view(f.student)).state.company.deposits.length, 0);
  }
});
