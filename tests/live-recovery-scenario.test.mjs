import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';
import { createRecoveryScenario, RECOVERY_DAYS, restorePendingRequest } from '../scripts/live-recovery-scenario.mjs';

async function fixture({ tamperSample, responseOverride } = {}) {
  const db = new MemoryFirestore(), store = new FirestoreStore(db, { now: () => 0 });
  const teacher = { id: 'teacher', role: 'instructor', name: 'Synthetic teacher' };
  const { id } = await store.create(teacher, { companyNames: Array.from({ length: 12 }, (_, i) => `Synthetic team ${i}`) });
  const invites = (await store.roster(teacher, id)).invites, students = [];
  for (let i = 0; i < 120; i++) {
    const student = { id: `student-${i}`, role: 'student', name: `Synthetic student ${i}`, token: 'test-token-not-for-pending-storage' };
    await store.join(student, invites[i % 12].code); students.push(student);
  }
  await store.command(teacher, id, { key: 'seed-one-daily-report', revision: 0, command: { type: 'step', hours: 24 } });
  const samples = [], checks = {}, faultOutcomes = { abortedBeforeCommit: 0, abortedAfterCommit: 0, discardedAccepted: 0 }, refreshes = [];
  let aborts = 0;
  const ctx = { run: 'synthetic-recovery-test', students, endpoint: `/sessions/${id}`, samples, checks, db, teacher, session: { id },
    async call(phase, path, who, body, timeout, options) {
      assert.equal(timeout, 15000);
      const fault = options?.fault;
      if (fault === 'abort-after-send' && aborts++ % 2 === 0) {
        // A connection can fail after sending while the backend never commits.
        faultOutcomes.abortedBeforeCommit++;
        const sample = { phase, status: 0, ms: 50, injectedFault: fault, wireStatus: 0 };
        tamperSample?.(sample); samples.push(sample); return { status: 0, fault, value: { error: 'Injected in-flight abort' } };
      }
      let response;
      try { response = { status: 200, value: body ? await store.command(who, id, body) : await store.view(who, id) }; }
      catch (error) { response = { status: error.status || 500, value: { error: error.message } }; }
      if (fault) {
        assert.equal(response.status, 200);
        faultOutcomes[fault === 'discard-response' ? 'discardedAccepted' : 'abortedAfterCommit']++;
        response = { status: 0, fault, value: { error: 'Injected lost reply after commit' } };
      }
      if (responseOverride) response = responseOverride(response, phase);
      const sample = { phase, status: response.status, ms: 5, ...(fault ? { injectedFault: fault, wireStatus: 200 } : {}) };
      tamperSample?.(sample); samples.push(sample); return response;
    },
    async refreshIdentity(who) { refreshes.push(who.id); who.token = 'replacement-test-token'; }
  };
  const persisted = async () => ({ state: (await store.readViewSnapshot(teacher, id)).state });
  return { ctx, store, id, checks, samples, faultOutcomes, refreshes, persisted };
}

test('five live recovery waves cover all120 identities, preserve exact retries and classify only proven expected faults', async () => {
  const f = await fixture(), recovery = createRecoveryScenario(f.ctx), initial = (await f.persisted()).state;
  for (const day of RECOVERY_DAYS) assert.equal((await recovery.afterDay({ day, persisted: f.persisted })).acceptedDecisions, 33);
  const report = recovery.finish(), final = (await f.persisted()).state;
  assert.equal(recovery.acceptedDecisions, 165); assert.equal(report.passed, true);
  assert.equal(final.revision - initial.revision, 165);
  assert.equal(final.companies.flatMap(c => c.deposits).length, 165);
  assert.equal((await f.store.requests.get()).docs.length, 166, '165 unique decisions plus the setup clock step');
  assert.deepEqual(final.snapshots, initial.snapshots);
  assert.equal(new Set(f.refreshes).size, 120);
  assert.deepEqual(f.faultOutcomes, { abortedBeforeCommit: 20, abortedAfterCommit: 20, discardedAccepted: 40 });
  assert.equal(f.samples.filter(s => s.status === 409).length, 635);
  assert.equal(f.samples.filter(s => s.status === 0).length, 80);
  assert.ok(f.samples.filter(s => s.status >= 400 || s.status === 0).every(s => s.expected && recovery.expectedSample(s)));
  assert.ok(f.samples.filter(s => s.status === 200).every(s => !recovery.expectedSample(s)));
  assert.equal(recovery.expectedSample({ phase: 'recovery-fake', status: 500, expected: true }), false);
  await assert.rejects(recovery.afterDay({ day: 1, persisted: f.persisted }), /must not run twice/);
});

test('ordinary failures and browser deadline violations cannot be hidden as intentional faults', async () => {
  const failed = await fixture({ responseOverride: (response, phase) => phase.endsWith('competing-120') && response.status === 200 ? { status: 503, value: {} } : response });
  const recovery = createRecoveryScenario(failed.ctx);
  await assert.rejects(recovery.afterDay({ day: 1, persisted: failed.persisted }));
  assert.ok(failed.samples.every(s => !recovery.expectedSample(s)));
  const slow = await fixture({ tamperSample: sample => { if (sample.phase.endsWith('competing-120')) sample.ms = 15001; } });
  await assert.rejects(createRecoveryScenario(slow.ctx).afterDay({ day: 1, persisted: slow.persisted }), /browser deadline/);
});

test('discarded-response injection requires evidence that the HTTP response was actually accepted', async () => {
  const f = await fixture({ tamperSample: sample => { if (sample.injectedFault === 'discard-response') sample.wireStatus = 503; } });
  const recovery = createRecoveryScenario(f.ctx);
  await assert.rejects(recovery.afterDay({ day: 1, persisted: f.persisted }));
  const forged = f.samples.find(s => s.injectedFault === 'discard-response');
  assert.ok(forged); assert.equal(recovery.expectedSample(forged), false);
});

test('pending reconstruction preserves key, reviewed revision and command without credentials', () => {
  const request = { key: 'synthetic-pending-key', revision: 17, command: { type: 'deposit', amount: 123400, term: 24 } };
  const restored = restorePendingRequest(JSON.stringify(request));
  assert.deepEqual(restored, request); restored.command.amount = 10000; assert.equal(request.command.amount, 123400);
  assert.throws(() => restorePendingRequest(JSON.stringify({ ...request, token: 'must-not-be-stored' })));
  assert.throws(() => restorePendingRequest(JSON.stringify({ ...request, revision: -1 })));
});
