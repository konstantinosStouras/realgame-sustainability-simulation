import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';
import { applyCommand, tick } from '../src/engine.mjs';

const teacher = { id: 'teacher', role: 'instructor', name: 'Synthetic teacher' };
const student = { id: 'student', role: 'student', name: 'Synthetic student' };
const pause = { type: 'clock', status: 'paused' };
async function fixture(options = {}) {
  let now = 0;
  const db = new MemoryFirestore(), store = new FirestoreStore(db, { now: () => now });
  const { id } = await store.create(teacher, options);
  await store.join(student, (await store.roster(teacher, id)).invites[0].code);
  await store.command(teacher, id, { key: 'start-fast-clock', revision: 0, command: { type: 'clock', status: 'running', secondsPerHour: 1 } });
  return { db, store, id, now: value => { now = value; } };
}
async function verifyReplay(f) {
  const replay = await f.store.replay(teacher, f.id), rebuilt = structuredClone(replay.initial);
  for (const row of replay.commands) {
    if (row.command.type === 'tick') tick(rebuilt);
    else applyCommand(rebuilt, row.actor, row.command, row.realAt, { replay: true });
  }
  const current = await f.store.readViewSnapshot(teacher, f.id);
  assert.deepEqual(JSON.parse(JSON.stringify(rebuilt)), current.state, 'replay matches persisted JSON, including zero normalization');
  return replay.commands;
}

test('stale instructor pause survives other browsers ticks and concurrent duplicate delivery', async () => {
  const f = await fixture();
  f.now(5000); await Promise.all(Array.from({ length: 12 }, () => f.store.view(student, f.id)));
  f.now(8300);
  const request = { key: 'stale-browser-pause', revision: 1, command: pause };
  const results = await Promise.all(Array.from({ length: 10 }, () => f.store.command(teacher, f.id, request)));
  assert.ok(results.every(r => r.revision === 10));
  const current = await f.store.view(teacher, f.id);
  assert.equal(current.state.hour, 8); assert.equal(current.state.status, 'paused');
  assert.equal((await f.store.sessionRef(f.id).get()).data().nextTickAt, null);
  const commands = await verifyReplay(f);
  assert.equal(commands.filter(r => r.command.type === 'tick').length, 8);
  assert.equal(commands.filter(r => r.command.type === 'clock' && r.command.status === 'paused').length, 1);
  f.now(99000); assert.equal((await f.store.view(teacher, f.id)).state.hour, 8);
});

test('one pause catches up multiple bounded transactions and reauthorizes each batch', async () => {
  const f = await fixture(); f.now(61000);
  let authorizations = 0; const actor = f.store.actor.bind(f.store);
  f.store.actor = (...args) => { authorizations++; return actor(...args); };
  const response = await f.store.command(teacher, f.id, { key: 'backlog-one-pause', revision: 0, command: pause });
  assert.equal(authorizations, 4, 'one read-only preflight and three authoritative catch-up transactions'); assert.equal(response.revision, 63);
  const current = await f.store.view(teacher, f.id);
  assert.equal(current.state.hour, 61); assert.equal(current.state.status, 'paused');
  assert.equal((await verifyReplay(f)).filter(r => r.command.type === 'tick').length, 61);
});

test('pause catch-up completes naturally without reopening and repeated stopped controls are no-ops', async () => {
  const f = await fixture({ days: 1 }); f.now(60000);
  const request = { key: 'pause-at-completion', revision: 0, command: pause };
  const response = await f.store.command(teacher, f.id, request);
  assert.equal(response.revision, 25);
  assert.deepEqual(await f.store.command(teacher, f.id, request), response);
  assert.equal((await f.store.command(teacher, f.id, { ...request, key: 'pause-completed-again' })).revision, 25);
  const view = await f.store.view(teacher, f.id);
  assert.equal(view.state.status, 'completed'); assert.equal(view.state.hour, 24);
  assert.equal((await verifyReplay(f)).filter(r => r.command.type === 'clock').length, 1);
  const finalStudentView = await f.store.view(student, f.id);
  assert.equal(finalStudentView.state.status,'completed');
  assert.equal(finalStudentView.state.snapshots.length,1);
  const paused = await fixture();
  await paused.store.command(teacher, paused.id, { key: 'first-plain-pause', revision: 1, command: pause });
  const second = await paused.store.command(teacher, paused.id, { key: 'another-plain-pause', revision: 0, command: pause });
  assert.equal(second.revision, 2); await verifyReplay(paused);
});

test('closed and deleted classrooms cannot be reopened by a delayed plain pause', async () => {
  const f = await fixture();
  await f.store.command(teacher, f.id, { key: 'close-before-pause', revision: 1, command: { type: 'closeSession' } });
  assert.equal((await f.store.command(teacher, f.id, { key: 'delayed-after-close', revision: 0, command: pause })).revision, 2);
  assert.equal((await f.store.view(teacher, f.id)).state.status, 'completed');
  await verifyReplay(f);
  await f.store.command(teacher, f.id, { key: 'delete-before-pause', revision: 2, command: { type: 'deleteSession' } });
  await assert.rejects(f.store.command(teacher, f.id, { key: 'delayed-after-delete', revision: 0, command: pause }), { status: 404 });
});

test('pause exception rejects future or malformed revisions and all additional options', async () => {
  const f = await fixture();
  for (const [i, revision] of [2, -1, 0.5, NaN, '1', null, undefined].entries()) {
    await assert.rejects(f.store.command(teacher, f.id, { key: `invalid-revision-${i}`, revision, command: pause }), { status: 409 });
  }
  for (const [i, command] of [
    { ...pause, secondsPerHour: 120 }, { ...pause, secondsPerHour: undefined }, { ...pause, extra: true },
    { type: 'configure', secondsPerHour: 120 }, { type: 'closeSession' }, { type: 'deleteSession' },
    { type: 'clock', status: 'running' }, { type: 'deposit', amount: 10000, term: 24 }
  ].entries()) await assert.rejects(f.store.command(teacher, f.id, { key: `stale-options-${i}`, revision: 0, command }), { status: 409 });
  await assert.rejects(f.store.command(student, f.id, { key: 'student-plain-pause', revision: 1, command: pause }), { status: 403 });
  const view = await f.store.view(teacher, f.id);
  assert.equal(view.state.status, 'running'); assert.equal(view.state.secondsPerHour, 1); assert.equal(view.state.revision, 1);
  f.now(2000);
  await assert.rejects(f.store.command(teacher, f.id, { key: 'speed-pause-after-tick', revision: 1, command: { ...pause, secondsPerHour: 120 } }), { status: 409 });
  const after = await f.store.view(teacher, f.id);
  assert.equal(after.state.hour, 2); assert.equal(after.state.status, 'running'); assert.equal(after.state.secondsPerHour, 1);
});

test('fresh authorization failure between catch-up batches prevents the pause', async () => {
  const f = await fixture(); f.now(60000);
  let calls = 0; const actor = f.store.actor.bind(f.store);
  f.store.actor = (...args) => { if (++calls > 2) throw Object.assign(new Error('Access revoked'), { status: 403 }); return actor(...args); };
  await assert.rejects(f.store.command(teacher, f.id, { key: 'revoked-mid-catchup', revision: 0, command: pause }), { status: 403 });
  const metadata = (await f.store.sessionRef(f.id).get()).data();
  assert.equal(metadata.hour, 24); assert.equal(metadata.status, 'running');
  assert.equal((await f.store.requests.get()).docs.length, 1, 'no pause receipt was written');
});
