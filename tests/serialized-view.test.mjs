import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createSession, applyCommand, publicView, publicViewJSON } from '../src/engine.mjs';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { createCloudHandler } from '../server/cloud-http.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';

const teacher = { id: 'teacher', role: 'instructor', name: 'Teacher "☀"' };
const student = { id: 'student', role: 'student', name: 'Student ☀' };
async function fixture() {
  let now = 0;
  const db = new MemoryFirestore(), store = new FirestoreStore(db, { now: () => now });
  const { id } = await store.create(teacher);
  await store.join(student, (await store.roster(teacher, id)).invites[0].code);
  return { store, db, id, now: value => { now = value; } };
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('serialized projections preserve all histories, private channels and mutable publicView isolation', () => {
  const state = createSession({ id: 'serialized-test', seed: 42 });
  const actors = state.companies.map(c => ({ ...student, id: c.id + '-student', companyId: c.id }));
  for (const actor of actors) {
    applyCommand(state, actor, { type: 'message', channel: `team:${actor.companyId}`, text: `Private ${actor.companyId} "☀"` });
    applyCommand(state, actor, { type: 'deposit', amount: 10000, term: 24 });
  }
  applyCommand(state, teacher, { type: 'step', hours: 48 });
  const before = JSON.stringify(state); freeze(state);
  for (const actor of [teacher, ...actors]) for (const preview of [undefined, 'invalid', ...state.companies.map(c => c.id)]) {
    const json = publicViewJSON(state, actor, preview), view = publicView(state, actor, preview);
    assert.equal(json, JSON.stringify(view));
    const parsed = JSON.parse(json);
    assert.equal(parsed.snapshots.length, 2);
    if (actor.role === 'student') {
      assert.equal(parsed.company.id, actor.companyId, 'student preview cannot select another company');
      assert.ok(parsed.events.every(e => e.companyId === actor.companyId));
      assert.ok(parsed.messages.every(m => m.channel === `team:${actor.companyId}`));
      assert.ok(parsed.audit.every(a => a.companyId === actor.companyId));
    }
    if (view.company) { view.company.accounts.cash = 0; parsed.company.ledger.length = 0; }
    view.catalog.suppliers[0].stock = 0; parsed.events.length = 0;
    assert.equal(JSON.stringify(state), before);
  }
});

test('serialized store views read fresh membership and metadata even for cached state', async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 120 }, () => f.store.viewJSON(student, f.id, 'company-2')));
  const expectedJSON = JSON.stringify(await f.store.view(student, f.id));
  for (const json of results) assert.equal(json, expectedJSON);
  await f.store.memberRef(f.id, student.id).set({ sessionId: f.id, userId: student.id, companyId: 'company-2' });
  assert.equal(JSON.parse(await f.store.viewJSON(student, f.id, 'company-1')).state.company.id, 'company-2');
  assert.equal(JSON.parse(await f.store.viewJSON(teacher, f.id, 'company-3')).state.company.id, 'company-3');
  await assert.rejects(f.store.viewJSON({ ...student, id: 'outsider' }, f.id), { status: 403 });
  await f.store.sessionRef(f.id).set({ studentAccess: false }, { merge: true });
  await assert.rejects(f.store.viewJSON(student, f.id), { status: 403 });
  assert.equal(JSON.parse(results[0]).state.company.id, 'company-1', 'previous response remains immutable text');
});

test('serialized views catch up the clock and reauthorize after pending work', async () => {
  const f = await fixture();
  await f.store.command(teacher, f.id, { key: 'serialized-start', revision: 0, command: { type: 'clock', status: 'running', secondsPerHour: 1 } });
  f.now(5000);
  const view = JSON.parse(await f.store.viewJSON(student, f.id));
  assert.equal(view.state.hour, 5); assert.equal(view.catchingUp, false);
  assert.deepEqual(view, JSON.parse(JSON.stringify(await f.store.view(student, f.id))));
  f.now(6000);
  const catchUp = f.store.catchUpViewClock.bind(f.store);
  f.store.catchUpViewClock = async id => { await catchUp(id); await f.store.sessionRef(id).set({ studentAccess: false }, { merge: true }); };
  await assert.rejects(f.store.viewJSON(student, f.id), { status: 403 });
});

test('cloud HTTP sends equivalent JSON directly with unchanged auth, errors and headers', async () => {
  const f = await fixture(); let verified = 0, serialized = 0;
  f.store.firebaseUser = async claims => claims;
  const viewJSON = f.store.viewJSON.bind(f.store);
  f.store.viewJSON = (...args) => { serialized++; return viewJSON(...args); };
  const handler = createCloudHandler({ store: f.store, projectId: 'synthetic', allowedOrigins: ['https://classroom.example'], verifyFirebase: async token => {
    verified++; if (token !== 'student') throw Object.assign(new Error('Invalid token'), { status: 401 }); return student;
  } });
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/sessions/${f.id}?company=company-2`;
  const get = (token = 'student') => fetch(url, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://classroom.example' } });
  try {
    const expected = JSON.parse(JSON.stringify(await f.store.view(student, f.id))), response = await get();
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), expected);
    assert.match(response.headers.get('content-type'), /^application\/json; charset=utf-8$/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://classroom.example');
    assert.equal(response.headers.get('vary'), 'Origin, Accept-Encoding');
    assert.equal(serialized, 1);
    const invalid = await get('invalid'); assert.equal(invalid.status, 401); await invalid.json();
    assert.equal(serialized, 1, 'invalid authentication never reaches projection');
    await f.store.sessionRef(f.id).set({ studentAccess: false }, { merge: true });
    const closed = await get(); assert.equal(closed.status, 403); assert.equal(typeof (await closed.json()).error, 'string');
    assert.equal(verified, 3, 'each request verifies its token');
    await f.store.sessionRef(f.id).set({ studentAccess: true }, { merge: true });
    f.store.viewJSON = undefined;
    const fallback = await get(); assert.deepEqual(await fallback.json(), expected, 'stores with the existing view contract remain supported');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
