import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';

const teacher = { id: 'teacher', name: 'Synthetic teacher', role: 'instructor' };
async function fixture(count = 1) {
  let now = 0;
  const db = new MemoryFirestore(), store = new FirestoreStore(db, { now: () => now });
  const { id } = await store.create(teacher, { companyNames: Array.from({ length: 12 }, (_, i) => `Synthetic team ${i}`) });
  const invites = (await store.roster(teacher, id)).invites, students = [];
  for (let i = 0; i < count; i++) {
    const user = { id: `student-${i}`, name: `Synthetic student ${i}`, role: 'student' };
    await store.join(user, invites[i % 12].code); students.push(user);
  }
  let decodes = 0;
  const readState = store.readState.bind(store);
  store.readState = (...args) => { decodes++; return readState(...args); };
  return { db, store, id, students, now: value => { now = value; }, decodes: () => decodes };
}
const deposit = (key, revision = 0) => ({ key, revision, command: { type: 'deposit', amount: 10000, term: 24 } });

test('120 competing paused decisions decode state once;119 obsolete decisions read only metadata', async () => {
  const f = await fixture(120);
  const results = await Promise.allSettled(f.students.map((user, i) => f.store.command(user, f.id, deposit(`competing-deposit-${i}`))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 119);
  assert.equal(f.decodes(), 1);
  assert.equal((await f.store.requests.get()).docs.length, 1);
  const current = (await f.store.readViewSnapshot(teacher, f.id)).state;
  assert.equal(current.revision, 1); assert.equal(current.companies.flatMap(c => c.deposits).length, 1);
});

test('exact retry receipts precede stale rejection and do not decode state again', async () => {
  const f = await fixture(), user = f.students[0], request = deposit('accepted-deposit');
  const original = await f.store.command(user, f.id, request);
  await f.store.command(teacher, f.id, { key: 'later-settings-change', revision: 1, command: { type: 'configure', name: 'Renamed synthetic session' } });
  const before = f.decodes();
  const retries = await Promise.all(Array.from({ length: 120 }, () => f.store.command(user, f.id, request)));
  assert.ok(retries.every(r => r.revision === original.revision)); assert.equal(f.decodes(), before);
  await assert.rejects(f.store.command(user, f.id, { ...request, command: { ...request.command, amount: 20000 } }), { status: 409 });
  assert.equal(f.decodes(), before);
});

test('fresh access and membership checks precede both receipt and metadata shortcuts', async () => {
  const f = await fixture(), user = f.students[0], request = deposit('receipt-before-revoke');
  await f.store.command(user, f.id, request);
  await f.store.sessionRef(f.id).set({ studentAccess: false }, { merge: true });
  const before = f.decodes();
  await assert.rejects(f.store.command(user, f.id, request), { status: 403 });
  await assert.rejects(f.store.command(user, f.id, deposit('new-stale-revoked')), { status: 403 });
  await assert.rejects(f.store.command({ ...user, id: 'outsider' }, f.id, request), { status: 403 });
  assert.equal(f.decodes(), before);
  await f.store.sessionRef(f.id).set({ studentAccess: true }, { merge: true });
  await f.db.runTransaction(async tx => tx.delete(f.store.memberRef(f.id, user.id)));
  await assert.rejects(f.store.command(user, f.id, request), { status: 403 });
  assert.equal(f.decodes(), before);
});

test('stale running decisions still commit elapsed clock hours before returning conflict', async () => {
  const f = await fixture();
  await f.store.command(teacher, f.id, { key: 'start-clock-before-stale', revision: 0, command: { type: 'clock', status: 'running', secondsPerHour: 1 } });
  f.now(3000); const before = f.decodes();
  await assert.rejects(f.store.command(f.students[0], f.id, deposit('running-stale-deposit', 0)), { status: 409 });
  assert.equal(f.decodes(), before + 1);
  const metadata = (await f.store.sessionRef(f.id).get()).data();
  assert.equal(metadata.hour, 3); assert.equal(metadata.revision, 4);
  assert.equal((await f.store.requests.get()).docs.length, 1);
});

test('narrow instructor pause retains its stale no-op behavior but options and lifecycle edits do not bypass metadata guard', async () => {
  const f = await fixture();
  await f.store.command(f.students[0], f.id, deposit('initial-financial-decision'));
  const before = f.decodes();
  const response = await f.store.command(teacher, f.id, { key: 'stale-plain-paused', revision: 0, command: { type: 'clock', status: 'paused' } });
  assert.equal(response.revision, 1); assert.equal(f.decodes(), before + 1);
  for (const [i, command] of [{ type: 'clock', status: 'paused', secondsPerHour: 2 }, { type: 'closeSession' }, { type: 'deleteSession' }, { type: 'configure', name: 'Stale title' }].entries()) {
    await assert.rejects(f.store.command(teacher, f.id, { key: `stale-non-pause-${i}`, revision: 0, command }), { status: 409 });
  }
  assert.equal(f.decodes(), before + 1);
});
