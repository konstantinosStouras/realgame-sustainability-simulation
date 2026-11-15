import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSession } from '../src/engine.mjs';
import { Store } from '../server/store.mjs';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';
import { TestClassroom } from '../src/test-classroom.mjs';
import { soloAdapter } from '../src/solo.mjs';

test('new sessions start paused at the introductory 40 s/h pace', () => {
  const state = createSession();
  assert.equal(state.secondsPerHour, 40);
  assert.equal(state.status, 'paused');
  assert.equal(state.hour, 0);
});

for (const kind of ['local', 'cloud']) test(`${kind}: creating new sessions preserves saved speeds in existing sessions`, async t => {
  const store = kind === 'local' ? new Store(':memory:') : new FirestoreStore(new MemoryFirestore());
  if (kind === 'local') t.after(() => store.close());
  const teacher = kind === 'local' ? store.addUser('teacher', 'Teacher', 'test-password-only', 'instructor') : { id: 'teacher', name: 'Teacher', role: 'instructor' };
  const read = async id => kind === 'local' ? store.session(id) : (await store.view(teacher, id)).state;
  for (const speed of [4, 15, 120]) {
    const existing = await store.create(teacher);
    await store.command(teacher, existing.id, { key: randomUUID(), revision: 0, command: { type: 'configure', secondsPerHour: speed } });
    const fresh = await store.create(teacher);
    assert.equal(fresh.secondsPerHour, 40);
    assert.equal((await read(fresh.id)).secondsPerHour, 40);
    assert.equal((await read(existing.id)).secondsPerHour, speed);
    // Starting and pausing an existing classroom must not reapply the new default.
    await store.command(teacher, existing.id, { key: randomUUID(), revision: 1, command: { type: 'clock', status: 'running' } });
    await store.command(teacher, existing.id, { key: randomUUID(), revision: 2, command: { type: 'clock', status: 'paused' } });
    assert.equal((await read(existing.id)).secondsPerHour, speed);
  }
});

test('test rounds inherit a saved speed and use 40 only when no speed was supplied', () => {
  const groups = [{ name: 'Test company', students: 1 }];
  assert.equal(new TestClassroom({ name: 'Fresh' }, groups, randomUUID).state.secondsPerHour, 40);
  for (const secondsPerHour of [4, 15, 120]) {
    assert.equal(new TestClassroom({ name: 'Existing', secondsPerHour }, groups, randomUUID).state.secondsPerHour, secondsPerHour);
  }
});

test('solo sandbox defaults to 40 but loading an existing save preserves its speed', t => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  t.after(() => { delete globalThis.localStorage; });
  assert.equal(soloAdapter().view().state.secondsPerHour, 40);
  const saved = createSession(); saved.secondsPerHour = 4;
  values.set('sustainability-studio-solo-v1', JSON.stringify(saved));
  assert.equal(soloAdapter().view().state.secondsPerHour, 4);
  assert.equal(JSON.parse(values.get('sustainability-studio-solo-v1')).secondsPerHour, 4);
});
