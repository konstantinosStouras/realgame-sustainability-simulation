import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createSession, applyCommand, assertInvariants } from '../src/engine.mjs';
import { encodeState, decodeState, CHUNK_BYTES, advanceCloudClock } from '../server/cloud-state.mjs';

test('cloud snapshots round-trip across multiple documents and detect corruption', () => {
  const state = createSession(); state.syntheticPayload = randomBytes(CHUNK_BYTES * 2).toString('base64');
  const encoded = encodeState(state);
  assert.ok(encoded.chunks.length > 1); assert.ok(encoded.chunks.every(c => c.length <= CHUNK_BYTES));
  assert.deepEqual(decodeState(encoded.chunks, encoded), state);
  const corrupt = encoded.chunks.map(c => Buffer.from(c)); corrupt[0][20] ^= 1;
  assert.throws(() => decodeState(corrupt, encoded), /integrity/);
  assert.throws(() => decodeState(encoded.chunks.slice(1), encoded), /integrity/);
});
test('cloud clock survives restart, catches up in bounded batches and preserves each tick', () => {
  const state = createSession(), teacher = { id: 'teacher', name: 'Teacher', role: 'instructor' };
  applyCommand(state, teacher, { type: 'clock', status: 'running', secondsPerHour: 1 });
  const first = advanceCloudClock(state, 1000, 5000, 3);
  assert.equal(state.hour, 3); assert.equal(first.nextTickAt, 4000); assert.equal(first.records.length, 3);
  const snapshot = encodeState(state), restored = decodeState(snapshot.chunks, snapshot);
  const second = advanceCloudClock(restored, first.nextTickAt, 5000);
  assert.equal(restored.hour, 5); assert.equal(second.nextTickAt, 6000);
  assert.deepEqual(second.records.map(r => r.revision), [5, 6]);
  assert.equal(advanceCloudClock(restored, second.nextTickAt, 5000).records.length, 0);
  assertInvariants(restored);
});
test('cloud clock stops at session completion and paused state never accrues hours', () => {
  const state = createSession({ days: 1 }), teacher = { id: 'teacher', name: 'Teacher', role: 'instructor' };
  assert.equal(advanceCloudClock(state, 1, 10000).records.length, 0);
  applyCommand(state, teacher, { type: 'clock', status: 'running', secondsPerHour: 1 });
  const result = advanceCloudClock(state, 1000, 100000, 120);
  assert.equal(state.hour, 24); assert.equal(state.status, 'completed'); assert.equal(result.nextTickAt, null);
  assert.equal(result.records.length, 24);
});
