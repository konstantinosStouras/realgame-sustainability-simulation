import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';
import { encodeState, decodeStateWithSize } from '../server/cloud-state.mjs';

// Unlike the serialized write double, independent read-only snapshots can wait
// concurrently. Freeze each one's source map to model metadata/chunk consistency.
class ConcurrentReadFirestore extends MemoryFirestore {
  readPaths = [];
  runTransaction(fn, options) {
    if (!options?.readOnly) return super.runTransaction(fn);
    const data = new Map(this.data);
    const snapshot = ref => {
      const value = data.get(ref.path);
      this.readPaths.push(ref.path);
      return { ref, id: ref.id, exists: value !== undefined, data: () => structuredClone(value) };
    };
    const get = async ref => {
      if (ref.id !== undefined) return snapshot(ref);
      const docs = [...data].filter(([path, value]) => path.startsWith(ref.path + '/') && !path.slice(ref.path.length + 1).includes('/') && ref.filters.every(([key, expected]) => value[key] === expected))
        .map(([path]) => snapshot({ path, id: path.split('/').at(-1) }));
      if (ref.order) docs.sort((a, b) => a.data()[ref.order] - b.data()[ref.order]);
      return { docs, empty: !docs.length };
    };
    const noWrite = () => { throw new Error('Read-only snapshot attempted a write'); };
    return fn({ get, getAll: (...refs) => Promise.all(refs.map(get)), set: noWrite, update: noWrite, create: noWrite, delete: noWrite });
  }
}
async function fixture(options = {}) {
  let now = 0;
  const db = new ConcurrentReadFirestore(), store = new FirestoreStore(db, { now: () => now, ...options });
  const teacher = { id: 'synthetic-teacher', role: 'instructor', name: 'Synthetic teacher' };
  const student = { id: 'synthetic-student', role: 'student', name: 'Synthetic student' };
  const session = await store.create(teacher), id = session.id;
  await store.join(student, (await store.roster(teacher, id)).invites[0].code);
  let decodes = 0;
  const readSnapshot = store.readSnapshot.bind(store);
  store.readSnapshot = (...args) => { decodes++; return readSnapshot(...args); };
  return { db, store, teacher, student, session, id, now: value => { now = value; }, decodes: () => decodes };
}

test('120 same-digest views share decoding but each reads current membership and metadata', async () => {
  const f = await fixture(); f.db.readPaths.length = 0;
  const views = await Promise.all(Array.from({ length: 120 }, () => f.store.view(f.student, f.id)));
  assert.equal(f.decodes(), 1);
  assert.equal(f.db.readPaths.filter(path => path === f.store.memberRef(f.id, f.student.id).path).length, 120);
  assert.equal(f.db.readPaths.filter(path => path === f.store.sessionRef(f.id).path).length, 240);
  assert.equal(f.store.viewSnapshotTasks.size, 0);
  assert.equal(f.store.viewSnapshots.size, 1);
  views[0].state.company.accounts.cash = -1;
  views[0].state.catalog.suppliers[0].stock = -1;
  const next = await f.store.view(f.student, f.id);
  assert.ok(next.state.company.accounts.cash > 0);
  assert.ok(next.state.catalog.suppliers[0].stock > 0);
  assert.equal(f.decodes(), 1);
});

test('cached content never reuses membership, access, or instructor preview', async () => {
  const f = await fixture();
  assert.equal((await f.store.view(f.student, f.id)).state.company.id, 'company-1');
  // Change only membership to ensure even an unchanged state digest cannot
  // carry the previous authorization. No production API bypass is exposed.
  await f.store.memberRef(f.id, f.student.id).set({ sessionId: f.id, userId: f.student.id, companyId: 'company-2' });
  assert.equal((await f.store.view(f.student, f.id, 'company-1')).state.company.id, 'company-2');
  assert.equal((await f.store.view(f.teacher, f.id, 'company-3')).state.company.id, 'company-3');
  assert.equal(f.decodes(), 1);
  await f.store.sessionRef(f.id).set({ studentAccess: false }, { merge: true });
  await assert.rejects(f.store.view(f.student, f.id), { status: 403 });
  await assert.rejects(f.store.view({ id: 'outsider', role: 'student' }, f.id), { status: 403 });
  assert.equal(f.decodes(), 1);
});

test('commands decode independently, change the digest, and never mutate an older cached snapshot', async () => {
  const f = await fixture();
  const old = await f.store.readViewSnapshot(f.student, f.id);
  await f.store.command(f.student, f.id, { key: 'cache-deposit-command', revision: 0, command: { type: 'deposit', amount: 10000, term: 24 } });
  assert.equal(f.decodes(), 2, 'the command reads its own transaction state');
  assert.equal(old.state.companies[0].deposits.length, 0);
  const changed = await f.store.view(f.student, f.id);
  assert.equal(changed.state.revision, 1);
  assert.equal(changed.state.company.deposits.length, 1);
  assert.equal(f.decodes(), 3);
  await f.store.replay(f.teacher, f.id);
  assert.equal(f.decodes(), 5, 'exports independently read current and initial state');
});

test('concurrent old and new digests retain their own transaction-consistent chunks', async () => {
  const f = await fixture();
  let release, started;
  const held = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
  const readSnapshot = f.store.readSnapshot.bind(f.store); let first = true;
  f.store.readSnapshot = async (...args) => { if (first) { first = false; started(); await held; } return readSnapshot(...args); };
  const oldView = f.store.view(f.student, f.id); await entered;
  await f.store.command(f.student, f.id, { key: 'new-digest-command', revision: 0, command: { type: 'deposit', amount: 10000, term: 24 } });
  const newView = await f.store.view(f.student, f.id);
  release(); const previous = await oldView;
  assert.equal(previous.state.revision, 0); assert.equal(previous.state.company.deposits.length, 0);
  assert.equal(newView.state.revision, 1); assert.equal(newView.state.company.deposits.length, 1);
  assert.equal((await f.store.view(f.student, f.id)).state.revision, 1);
});

test('failed shared decoding rejects every waiter and permits a clean retry', async () => {
  const f = await fixture(), chunk = f.store.sessionRef(f.id).collection('stateChunks').doc('0');
  const original = (await chunk.get()).data(); await chunk.set({ data: Buffer.from('corrupt synthetic snapshot') });
  const failed = await Promise.allSettled(Array.from({ length: 12 }, () => f.store.view(f.student, f.id)));
  assert.ok(failed.every(result => result.status === 'rejected' && /integrity/.test(result.reason.message)));
  assert.equal(f.decodes(), 1); assert.equal(f.store.viewSnapshotTasks.size, 0); assert.equal(f.store.viewSnapshots.size, 0);
  await chunk.set(original);
  assert.equal((await f.store.view(f.student, f.id)).state.revision, 0);
  assert.equal(f.decodes(), 2);
});

test('cache budget charges raw UTF-8 bytes, evicts LRU entries, expires, and caps entry count', async () => {
  const f = await fixture({ viewCacheTtlMs: 100 });
  await f.store.view(f.student, f.id);
  const rawBytes = Buffer.byteLength(JSON.stringify(f.session));
  assert.equal(f.store.viewCacheBytes, rawBytes);
  f.store.viewCacheMaxBytes = rawBytes * 2;
  for (let i = 0; i < 3; i++) { const s = await f.store.create(f.teacher); await f.store.view(f.teacher, s.id); }
  assert.equal(f.store.viewSnapshots.size, 2);
  assert.equal(f.store.viewCacheBytes, rawBytes * 2);
  assert.ok([...f.store.viewSnapshots.keys()].every(key => !key.includes(f.id)));
  f.now(101); await f.store.view(f.student, f.id);
  assert.equal(f.store.viewSnapshots.size, 1); assert.equal(f.store.viewCacheBytes, rawBytes);
  f.store.viewCacheMaxBytes = rawBytes * 10;
  for (let i = 0; i < 5; i++) { const s = await f.store.create(f.teacher); await f.store.view(f.teacher, s.id); }
  assert.equal(f.store.viewSnapshots.size, 4);
});

test('valid snapshots larger than the cache budget are decoded correctly without retention', async () => {
  const f = await fixture({ viewCacheMaxBytes: 1 });
  const views = await Promise.all(Array.from({ length: 12 }, () => f.store.view(f.student, f.id)));
  assert.ok(views.every(view => view.state.company.id === 'company-1'));
  assert.equal(f.decodes(), 1, 'oversized concurrent requests can share in-flight work');
  assert.equal(f.store.viewCacheBytes, 0); assert.equal(f.store.viewSnapshots.size, 0); assert.equal(f.store.viewSnapshotTasks.size, 0);
  assert.equal((await f.store.view(f.student, f.id)).state.revision, 0);
  assert.equal(f.decodes(), 2, 'the next request rereads an uncached large snapshot');
  const sample = { text: '🌱 Ελληνικά 東京' }, encoded = encodeState(sample);
  assert.deepEqual(decodeStateWithSize(encoded.chunks, encoded), { state: sample, rawBytes: Buffer.byteLength(JSON.stringify(sample)) });
});
