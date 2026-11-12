import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';

const teacher = { id: 'teacher', name: 'Teacher', role: 'instructor' };
function fixture() {
  let now = 0;
  const db = new MemoryFirestore(), store = new FirestoreStore(db, { now: () => now });
  return { db, store, now: value => { now = value; } };
}
async function start(store) {
  const session = await store.create(teacher);
  await store.command(teacher, session.id, { key: 'start-clock-key-' + session.id, revision: 0, command: { type: 'clock', status: 'running' } });
  return session.id;
}

test('a reviewed instructor pause commits elapsed ticks and stops atomically without losing time', async () => {
  const f = fixture(), id = await start(f.store);
  f.now(20000);
  const pause = { key: 'pause-stale-key', revision: 1, command: { type: 'clock', status: 'paused' } };
  const paused = await f.store.command(teacher, id, pause);
  assert.equal(paused.revision, 7);
  const current = await f.store.view(teacher, id);
  assert.equal(current.state.hour, 5);
  assert.equal(current.state.revision, 7);
  assert.equal(current.state.status, 'paused');
  assert.equal((await f.store.requests.get()).docs.length, 2);
  assert.deepEqual(await f.store.command(teacher, id, pause), paused, 'lost-response retry returns original pause receipt');
  f.now(40000);
  const later = await f.store.view(teacher, id);
  assert.equal(later.state.hour, 5);
  assert.equal(later.state.status, 'paused');
  const replay = await f.store.replay(teacher, id);
  assert.equal(replay.commands.filter(r => r.command.type === 'tick').length, 5);
  assert.equal(replay.commands.filter(r => r.command.type === 'clock').length, 2);
});

test('an already stale pause commits due time but cannot bypass reviewed revision checks', async () => {
  const f = fixture(), id = await start(f.store);
  f.now(20000);
  await assert.rejects(f.store.command(teacher, id, { key: 'stale-pause-key', revision: 0, command: { type: 'clock', status: 'paused' } }), error => error.status === 409);
  const current = await f.store.view(teacher, id);
  assert.equal(current.state.hour, 5);
  assert.equal(current.state.revision, 6);
  assert.equal(current.state.status, 'running');
  assert.equal((await f.store.requests.get()).docs.length, 1);
});

test('the fastest clock can be paused after a multi-second request without retry starvation', async () => {
  const f = fixture(), session = await f.store.create(teacher);
  await f.store.command(teacher, session.id, { key: 'start-fast-clock', revision: 0, command: { type: 'clock', status: 'running', secondsPerHour: 1 } });
  // A reviewed revision is submitted after >1 tick of authentication/network latency.
  f.now(3100);
  const request = { key: 'pause-fast-clock', revision: 1, command: { type: 'clock', status: 'paused' } };
  const response = await f.store.command(teacher, session.id, request);
  assert.equal(response.revision, 5);
  f.now(10000);
  const current = await f.store.view(teacher, session.id);
  assert.equal(current.state.hour, 3);
  assert.equal(current.state.status, 'paused');
  assert.deepEqual(await f.store.command(teacher, session.id, request), response);
});

test('a pause cannot discard overdue hours beyond the bounded catch-up batch', async () => {
  const f = fixture(), session = await f.store.create(teacher);
  await f.store.command(teacher, session.id, { key: 'start-backlog-clock', revision: 0, command: { type: 'clock', status: 'running', secondsPerHour: 1 } });
  f.now(60000);
  const request = { key: 'pause-backlog-clock', revision: 1, command: { type: 'clock', status: 'paused' } };
  await assert.rejects(f.store.command(teacher, session.id, request), error => error.status === 409);
  const interim = await f.store.sessionRef(session.id).get();
  assert.equal(interim.data().hour, 24);
  assert.equal(interim.data().status, 'running');
  const reviewed = await f.store.view(teacher, session.id); // catches up the next 24 hours
  const receipt = await f.store.command(teacher, session.id, { ...request, revision: reviewed.state.revision });
  const final = await f.store.view(teacher, session.id);
  assert.equal(final.state.hour, 60);
  assert.equal(final.state.status, 'paused');
  assert.equal(receipt.revision, 62);
  assert.equal((await f.store.replay(teacher, session.id)).commands.filter(r => r.command.type === 'tick').length, 60);
});

test('economic decisions cannot backdate themselves ahead of due cloud ticks', async () => {
  const f = fixture(), id = await start(f.store);
  const student = { id: 'student', role: 'student', name: 'Student' };
  const roster = await f.store.roster(teacher, id);
  await f.store.join(student, roster.invites[0].code);
  f.now(4000);
  const deposit = { key: 'deposit-after-tick', revision: 1, command: { type: 'deposit', amount: 10000, term: 24 } };
  await assert.rejects(f.store.command(student, id, deposit), error => error.status === 409);
  const current = await f.store.view(student, id);
  assert.equal(current.state.hour, 1);
  assert.equal(current.state.company.deposits.length, 0);
  await f.store.command(student, id, { ...deposit, revision: current.state.revision });
  const saved = await f.store.view(student, id);
  assert.equal(saved.state.company.deposits[0].placedAt, 1);
});

test('one failed scheduled classroom is reported and does not stop healthy classrooms', async () => {
  const f = fixture(), brokenId = await start(f.store), healthyId = await start(f.store);
  const corrupt = f.store.sessionRef(brokenId).collection('stateChunks').doc('0');
  await corrupt.set({ data: Buffer.from('corrupt snapshot') });
  f.now(20000);
  let outcome, thrown;
  try { outcome = await f.store.runDueClocks(); } catch (error) { thrown = error; }
  const healthy = await f.store.sessionRef(healthyId).get();
  assert.equal(healthy.data().hour, 5, 'healthy clocks must advance even if an earlier session fails');
  assert.equal(thrown, undefined);
  assert.equal(outcome.failures.length, 1);
  assert.equal(outcome.failures[0].sessionId, brokenId);
  const broken = await f.store.sessionRef(brokenId).get();
  assert.equal(broken.data().hour, 0, 'failed transaction does not partially advance');
  assert.equal(broken.data().lastClockError.at, 20000);
  assert.match(broken.data().lastClockError.message, /clock/i);
  assert.equal((await f.store.replay(teacher, healthyId)).commands.filter(r => r.command.type === 'tick').length, 5);
});

test('concurrent duplicate decisions retain one receipt and one economic effect', async () => {
  const f = fixture(), s = await f.store.create(teacher), student = { id: 'student', role: 'student', name: 'Student' };
  const roster = await f.store.roster(teacher, s.id);
  await f.store.join(student, roster.invites[0].code);
  const request = { key: 'same-request-key', revision: 0, command: { type: 'deposit', amount: 10000, term: 24 } };
  const [a, b] = await Promise.all([f.store.command(student, s.id, request), f.store.command(student, s.id, request)]);
  assert.deepEqual(a, b);
  const current = await f.store.view(student, s.id);
  assert.equal(current.state.revision, 1);
  assert.equal(current.state.company.deposits.length, 1);
  await assert.rejects(f.store.command(student, s.id, { ...request, command: { ...request.command, amount: 20000 } }), error => error.status === 409);
});

test('simultaneous view and scheduler catch-up do not apply the same due hour twice', async () => {
  const f = fixture(), id = await start(f.store);
  f.now(20000);
  await Promise.all([f.store.view(teacher, id), f.store.runDueClocks(), f.store.view(teacher, id)]);
  const current = await f.store.view(teacher, id);
  assert.equal(current.state.hour, 5);
  assert.equal(current.state.revision, 6);
  const replay = await f.store.replay(teacher, id);
  assert.equal(replay.commands.filter(r => r.command.type === 'tick').length, 5);
});
