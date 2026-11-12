import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { applyCommand, tick } from '../src/engine.mjs';

// Integration checks against the emulator or an explicitly authorized test
// namespace in Firestore. The caller supplies credentials; none are stored.
export async function checkCloudStore(db) {
  const prefix = `qa_${Date.now()}_${randomBytes(4).toString('hex')}`;
  let now = 100000;
  const first = new FirestoreStore(db, { prefix, now: () => now });
  const second = new FirestoreStore(db, { prefix, now: () => now });
  try {
    const teacher = await first.firebaseUser({ uid: 'qa-teacher', name: 'Synthetic Instructor', email_verified: true, instructor: true });
    const student = await first.firebaseUser({ uid: 'qa-student', name: 'Synthetic Student', email_verified: true });
    const outsider = await first.firebaseUser({ uid: 'qa-outsider', name: 'Synthetic Outsider', email_verified: true });
    await assert.rejects(() => first.create(student), /Instructor/);
    const session = await first.create(teacher, { name: 'Disposable storage verification' });
    const roster = await first.roster(teacher, session.id);
    await first.join(student, roster.invites.find(i => i.companyId === 'company-1').code);
    await assert.rejects(() => first.view(outsider, session.id), /not a member/);
    await assert.rejects(() => first.roster(student, session.id), /Instructor/);
    const request = { key: 'concurrent-identical', revision: 0, command: { type: 'purchase', supplierId: 'frame-circular', qty: 10 } };
    const duplicate = await Promise.all([first.command(student, session.id, request), second.command(student, session.id, request)]);
    assert.deepEqual(duplicate[0], duplicate[1]);
    let view = await second.view(student, session.id);
    assert.equal(view.state.company.purchases.length, 1);
    const competing = await Promise.allSettled([first.command(student, session.id, { ...request, key: 'concurrent-distinct-a', revision: view.state.revision }), second.command(student, session.id, { ...request, key: 'concurrent-distinct-b', revision: view.state.revision })]);
    assert.equal(competing.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(competing.find(r => r.status === 'rejected').reason.status, 409);
    const send = async (who, command, key) => first.command(who, session.id, { key, revision: (await first.view(who, session.id)).state.revision, command });
    await send(student, { type: 'message', channel: 'team:company-1', text: 'QA private plan' }, 'private-chat-check');
    assert.equal((await first.view(teacher, session.id)).state.messages.length, 0);
    assert.doesNotMatch(JSON.stringify(await first.replay(teacher, session.id)), /QA private plan/);
    await first.assign(teacher, session.id, student.id, 'company-2');
    assert.equal((await second.view(student, session.id)).actor.companyId, 'company-2');
    assert.equal((await second.view(student, session.id)).state.messages.length, 0);
    await send(teacher, { type: 'step', hours: 24 }, 'daily-snapshot-check');
    view = await second.view(student, session.id); assert.equal(view.state.hour, 24); assert.equal(view.state.snapshots.length, 1);
    await assert.rejects(() => first.command(student, session.id, { key: 'denied-teacher-command', revision: view.state.revision, command: { type: 'step', hours: 1 } }), /Instructor/);
    assert.equal((await first.view(student, session.id)).state.revision, view.state.revision);
    await send(teacher, { type: 'clock', status: 'running', secondsPerHour: 1 }, 'start-durable-clock');
    now += 5000;
    await Promise.all([first.view(student, session.id), second.view(teacher, session.id), second.runDueClocks()]);
    view = await new FirestoreStore(db, { prefix, now: () => now }).view(student, session.id);
    assert.equal(view.state.hour, 29);
    await send(teacher, { type: 'clock', status: 'paused' }, 'pause-durable-clock');
    const exported = await first.replay(teacher, session.id), replayed = structuredClone(exported.initial);
    for (const record of exported.commands) { if (record.command.type === 'tick') tick(replayed); else applyCommand(replayed, record.actor, record.command, record.realAt, { replay: true }); }
    const final = (await first.view(teacher, session.id)).state;
    assert.equal(replayed.revision, final.revision); assert.equal(replayed.hour, final.hour);
    now += 100000; assert.equal((await second.view(student, session.id)).state.hour, 29);
    assert.equal((await first.list(student)).length, 1);
    return { concurrentRetry: true, staleDecisionRejected: true, membership: true, privateChat: true, assignment: true, dailySnapshots: true, restartPersistence: true, clockDeduplicated: true, replay: true };
  } finally {
    // Delete only the random, test-owned namespace created by this invocation.
    assert.match(prefix, /^qa_\d+_[a-f0-9]{8}$/);
    for (const suffix of ['Sessions', 'Users', 'Members', 'Invites', 'Requests']) await db.recursiveDelete(db.collection(prefix + suffix));
  }
}
