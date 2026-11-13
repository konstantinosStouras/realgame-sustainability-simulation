import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';

// This checks the SDK transaction contract, not production throughput. The
// existing memory helper serializes transactions and cannot model Firestore
// lock contention; live capacity measurements are a separate test.
class ObservedFirestore extends MemoryFirestore {
  transactions = [];
  runTransaction(fn, options) {
    const record = { readOnly: options?.readOnly === true, reads: [], writes: 0 };
    this.transactions.push(record);
    return super.runTransaction(tx => fn({
      ...tx,
      get: ref => { record.reads.push(ref.path); return tx.get(ref); },
      getAll: (...refs) => { record.reads.push(...refs.map(ref => ref.path)); return tx.getAll(...refs); },
      ...Object.fromEntries(['set', 'update', 'create', 'delete'].map(method => [method, (...args) => {
        assert.equal(record.readOnly, false, 'read-only transactions cannot stage writes');
        record.writes++; return tx[method](...args);
      }]))
    }));
  }
}
async function fixture() {
  let now = 0;
  const db = new ObservedFirestore(), store = new FirestoreStore(db, { now: () => now });
  const teacher = await store.firebaseUser({ uid: 'synthetic-teacher', email_verified: true, instructor: true, name: 'Synthetic teacher' });
  const student = await store.firebaseUser({ uid: 'synthetic-student', email_verified: true, name: 'Synthetic student' });
  const peer = await store.firebaseUser({ uid: 'synthetic-peer', email_verified: true, name: 'Synthetic peer' });
  const session = await store.create(teacher);
  const invites = (await store.roster(teacher, session.id)).invites;
  await store.join(student, invites[0].code); await store.join(peer, invites[1].code);
  return { db, store, teacher, student, peer, id: session.id, now: value => { now = value; } };
}

test('paused views and pure-read endpoints use consistent read-only transactions', async () => {
  const f = await fixture(); f.db.transactions.length = 0;
  const studentView = await f.store.view(f.student, f.id);
  assert.equal(studentView.state.company.id, 'company-1');
  assert.equal(studentView.catchingUp, false);
  assert.equal(f.db.transactions.length, 1);
  assert.ok(f.db.transactions[0].reads.includes(f.store.memberRef(f.id, f.student.id).path));
  assert.ok(f.db.transactions[0].reads.includes(f.store.sessionRef(f.id).path));
  assert.ok(f.db.transactions[0].reads.includes(f.store.sessionRef(f.id).collection('stateChunks').doc('0').path));
  await f.store.roster(f.teacher, f.id);
  await f.store.testTemplate(f.teacher, f.id);
  await f.store.replay(f.teacher, f.id);
  // Add only the snapshot-listener protocol that the memory helper lacks.
  const sessionRef = f.store.sessionRef.bind(f.store);
  f.store.sessionRef = id => {
    const ref = sessionRef(id);
    ref.onSnapshot = notify => { void ref.get().then(notify); return () => {}; };
    return ref;
  };
  assert.deepEqual(await f.store.updates(f.student, f.id, 1), { revision: 0 });
  assert.equal(f.db.transactions.length, 5);
  assert.ok(f.db.transactions.every(tx => tx.readOnly && tx.writes === 0));
});

test('120 due views share one clock catch-up, then each reauthorizes its own snapshot', async () => {
  const f = await fixture();
  await f.store.command(f.teacher, f.id, { key: 'capacity-clock-start', revision: 0, command: { type: 'clock', status: 'running', secondsPerHour: 1 } });
  f.now(5000); f.db.transactions.length = 0;
  const views = await Promise.all(Array.from({ length: 120 }, (_, i) => f.store.view(i % 2 ? f.peer : f.student, f.id)));
  for (let i = 0; i < views.length; i++) {
    assert.equal(views[i].state.hour, 5);
    assert.equal(views[i].state.revision, 6);
    assert.equal(views[i].state.company.id, i % 2 ? 'company-2' : 'company-1');
    assert.equal(views[i].catchingUp, false);
  }
  const clockWrites = f.db.transactions.filter(tx => !tx.readOnly);
  assert.equal(clockWrites.length, 1, 'a burst within one function instance must share its clock transaction');
  assert.equal(f.db.transactions.filter(tx => tx.readOnly).length, 240, 'each caller reauthorizes after catch-up');
  assert.equal(f.store.viewClockTasks.size, 0);
  assert.equal((await f.store.replay(f.teacher, f.id)).commands.filter(row => row.command.type === 'tick').length, 5);
});

test('due-clock view cannot reuse access revoked while catch-up was pending', async () => {
  const f = await fixture();
  await f.store.command(f.teacher, f.id, { key: 'revocation-clock-start', revision: 0, command: { type: 'clock', status: 'running', secondsPerHour: 1 } });
  f.now(1000);
  const catchUp = f.store.catchUpViewClock.bind(f.store);
  f.store.catchUpViewClock = async id => {
    await catchUp(id);
    await f.store.command(f.teacher, id, { key: 'revoke-during-view', revision: 2, command: { type: 'configure', studentAccess: false } });
  };
  await assert.rejects(f.store.view(f.student, f.id), { status: 403 });
  const current = await f.store.view(f.teacher, f.id);
  assert.equal(current.state.hour, 1);
  assert.equal(current.state.studentAccess, false);
});

test('outsiders cannot trigger view catch-up and a failed clock task releases its slot', async () => {
  const f = await fixture();
  await f.store.command(f.teacher, f.id, { key: 'failure-clock-start', revision: 0, command: { type: 'clock', status: 'running', secondsPerHour: 1 } });
  f.now(1000); f.db.transactions.length = 0;
  await assert.rejects(f.store.view({ id: 'outsider', role: 'student' }, f.id), { status: 403 });
  assert.ok(f.db.transactions.every(tx => tx.readOnly));
  assert.equal((await f.store.sessionRef(f.id).get()).data().hour, 0);
  const writeState = f.store.writeState;
  f.store.writeState = () => { throw new Error('Synthetic transaction failure'); };
  await assert.rejects(f.store.view(f.student, f.id), /Synthetic transaction failure/);
  assert.equal(f.store.viewClockTasks.size, 0);
  assert.equal((await f.store.sessionRef(f.id).get()).data().hour, 0);
  f.store.writeState = writeState;
  assert.equal((await f.store.view(f.student, f.id)).state.hour, 1);
});

test('clock speed settings reschedule the next hour but unrelated settings preserve its deadline', async () => {
  const f = await fixture();
  const send = async (key, command) => {
    const revision = (await f.store.sessionRef(f.id).get()).data().revision;
    return f.store.command(f.teacher, f.id, { key, revision, command });
  };
  const due = async () => (await f.store.sessionRef(f.id).get()).data().nextTickAt;
  await send('speed-start-120', { type: 'clock', status: 'running', secondsPerHour: 120 });
  assert.equal(await due(), 120000);
  f.now(1000);
  await send('speed-change-1', { type: 'configure', secondsPerHour: 1 });
  assert.equal(await due(), 2000);
  f.now(2000); assert.equal((await f.store.view(f.teacher, f.id)).state.hour, 1);
  f.now(2500);
  await send('speed-change-120', { type: 'configure', secondsPerHour: 120 });
  assert.equal(await due(), 122500);
  f.now(3000);
  await send('same-speed-and-name', { type: 'configure', secondsPerHour: 120, name: 'Renamed synthetic classroom' });
  assert.equal(await due(), 122500);
  assert.equal((await f.store.view(f.teacher, f.id)).state.hour, 1);
  f.now(122500); assert.equal((await f.store.view(f.teacher, f.id)).state.hour, 2);
});

test('profile field order does not write unchanged data; real role/name changes still persist', async () => {
  const f = await fixture();
  const profile = f.store.userRef(f.student.id), data = (await profile.get()).data();
  await profile.set(Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b))));
  let writes = 0;
  const userRef = f.store.userRef.bind(f.store);
  f.store.userRef = id => {
    const ref = userRef(id), set = ref.set.bind(ref);
    ref.set = (...args) => { writes++; return set(...args); };
    return ref;
  };
  const claims = { uid: 'synthetic-student', email_verified: true, name: 'Synthetic student' };
  assert.deepEqual(await f.store.firebaseUser(claims), f.student);
  assert.equal(writes, 0);
  assert.equal((await f.store.firebaseUser({ ...claims, name: 'Updated synthetic name', instructor: true })).role, 'instructor');
  assert.equal(writes, 1);
  assert.equal((await f.store.firebaseUser(claims)).role, 'student');
  assert.equal(writes, 2);
  await assert.rejects(f.store.firebaseUser({ ...claims, email_verified: false }), { status: 403 });
  assert.equal(writes, 2);
});
