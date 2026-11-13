import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Count entry BEFORE the memory adapter serializes writes. Concurrent read-only
// snapshots deliberately bypass its queue, exposing same-version admission races.
// This checks application admission; it does not emulate Firestore lock latency.
class AdmissionFirestore extends MemoryFirestore {
  activeWrites = 0; peakWrites = 0; writes = 0; activeReads = 0; peakReads = 0;
  holdFirst = null; afterWrite = null;
  async runTransaction(fn, options) {
    if (options?.readOnly) {
      this.activeReads++; this.peakReads = Math.max(this.peakReads, this.activeReads);
      const snapshot = new Map(this.data);
      const get = async ref => {
        await flush();
        if (!ref.path) throw new Error('This admission fixture only supports document reads');
        const value = snapshot.get(ref.path);
        return { ref, id: ref.id, exists: value !== undefined, data: () => structuredClone(value) };
      };
      try { return await fn({ get, getAll: (...refs) => Promise.all(refs.map(get)) }); }
      finally { this.activeReads--; }
    }
    this.activeWrites++; this.peakWrites = Math.max(this.peakWrites, this.activeWrites);
    const number = ++this.writes;
    try {
      if (number === 1 && this.holdFirst) await this.holdFirst.promise;
      const value = await super.runTransaction(fn);
      await this.afterWrite?.(number);
      return value;
    } finally { this.activeWrites--; }
  }
  reset() { this.activeWrites = this.peakWrites = this.writes = this.activeReads = this.peakReads = 0; }
}

async function fixture(count = 120) {
  const db = new AdmissionFirestore(), store = new FirestoreStore(db);
  const teacher = { id: 'teacher', role: 'instructor' };
  const state = await store.create(teacher, { id: 'admission-a', companyNames: Array.from({ length: 12 }, (_, i) => `Team ${i + 1}`) });
  const students = Array.from({ length: count }, (_, i) => ({ id: `student-${i}`, role: 'student', name: `Student ${i}` }));
  for (let i = 0; i < students.length; i++) await store.memberRef(state.id, students[i].id).set({ sessionId: state.id, userId: students[i].id, companyId: `company-${i % 12 + 1}` });
  db.reset(); db.holdFirst = gate();
  return { db, store, teacher, state, students };
}
const request = (i, amount = 10000) => ({ key: `admission-request-${i}`, revision: 0, command: { type: 'deposit', amount, term: 24 } });
async function waitForWriter(db) {
  for (let i = 0; i < 40 && !db.activeWrites; i++) await flush();
  assert.ok(db.activeWrites, 'a writer should reach the held transaction');
  for (let i = 0; i < 12; i++) await flush();
}

test('120 same-version clients admit one writer before commit, then reject stale peers through concurrent read-only checks', async () => {
  const f = await fixture();
  const wave = Promise.allSettled(f.students.map((student, i) => f.store.command(student, f.state.id, request(i))));
  try {
    await waitForWriter(f.db);
    assert.equal(f.db.activeWrites, 1, 'the store must not enqueue120 write transactions behind the adapter lock');
    assert.equal(f.db.writes, 1);
    assert.ok(f.db.peakReads > 1, 'metadata preflights must not serialize every stale reader');
  } finally { f.db.holdFirst.resolve(); }
  const results = await wave;
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 119);
  assert.equal(f.db.writes, 1, 'stale peers must not open write transactions after the winner commits');
  assert.equal(f.db.peakWrites, 1); assert.equal(f.store.commandWrites.size, 0);
});

test('120 exact concurrent retries share one economic effect and receive identical authorized receipts', async () => {
  const f = await fixture(1), saved = request('duplicate');
  const wave = Promise.all(Array.from({ length: 120 }, () => f.store.command(f.students[0], f.state.id, structuredClone(saved))));
  try { await waitForWriter(f.db); assert.equal(f.db.activeWrites, 1); }
  finally { f.db.holdFirst.resolve(); }
  const receipts = await wave;
  assert.ok(receipts.every(receipt => receipt.revision === 1));
  for (const receipt of receipts) assert.deepEqual(receipt, receipts[0]);
  assert.equal(f.db.writes, 1); assert.equal(f.store.commandWrites.size, 0);
  const view = await f.store.view(f.students[0], f.state.id);
  assert.equal(view.state.company.deposits.length, 1);
});

test('waiting retries reauthorize membership before returning a committed receipt', async () => {
  const f = await fixture(1), saved = request('revocation');
  const winner = f.store.command(f.students[0], f.state.id, structuredClone(saved));
  await waitForWriter(f.db);
  const waiting = Promise.allSettled(Array.from({ length: 12 }, () => f.store.command(f.students[0], f.state.id, structuredClone(saved))));
  f.db.afterWrite = async number => { if (number === 1) f.db.data.delete(f.store.memberRef(f.state.id, f.students[0].id).path); };
  f.db.holdFirst.resolve(); await winner;
  const outcomes = await waiting;
  assert.equal(outcomes.filter(result => result.status === 'rejected' && result.reason.status === 403).length, 12);
  assert.equal(f.db.writes, 1); assert.equal(f.store.commandWrites.size, 0);
});

test('a rejected writer releases admission and does not poison valid waiting commands', async () => {
  const f = await fixture(2);
  const invalid = f.store.command(f.students[0], f.state.id, request('invalid', 1));
  const rejected = assert.rejects(invalid, error => error.status === 400);
  await waitForWriter(f.db);
  const valid = f.store.command(f.students[1], f.state.id, request('valid'));
  f.db.holdFirst.resolve(); await rejected;
  assert.equal((await valid).revision, 1);
  assert.equal(f.db.peakWrites, 1); assert.equal(f.db.writes, 2); assert.equal(f.store.commandWrites.size, 0);
});

test('a held classroom writer does not block an independent classroom', async () => {
  const f = await fixture(1); f.db.holdFirst = null;
  const other = await f.store.create(f.teacher, { id: 'admission-b' });
  await f.store.memberRef(other.id, f.students[0].id).set({ sessionId: other.id, userId: f.students[0].id, companyId: 'company-1' });
  f.db.reset(); f.db.holdFirst = gate();
  const first = f.store.command(f.students[0], f.state.id, request('class-a'));
  await waitForWriter(f.db);
  let secondDone = false;
  const second = f.store.command(f.students[0], other.id, request('class-b')).then(value => { secondDone = true; return value; });
  try {
    for (let i = 0; i < 30 && !secondDone; i++) await flush();
    assert.equal(secondDone, true, 'independent classrooms must not share one global admission barrier');
    assert.equal((await second).revision, 1);
  } finally { f.db.holdFirst.resolve(); }
  await first; assert.equal(f.store.commandWrites.size, 0);
});
