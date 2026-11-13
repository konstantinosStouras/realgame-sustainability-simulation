import assert from 'node:assert/strict';
import { assertInvariants } from '../src/engine.mjs';

export const RECOVERY_DAYS = [1, 15, 30, 45, 59];

// A deliberately small JSON-only stand-in for browser pending-request storage.
// Tokens stay on the identity object and are never persisted with a decision.
export function restorePendingRequest(serialized) {
  const request = JSON.parse(serialized);
  assert.equal(typeof request.key, 'string');
  assert.ok(Number.isSafeInteger(request.revision) && request.revision >= 0);
  assert.equal(request.command?.type, 'deposit');
  assert.deepEqual(Object.keys(request).sort(), ['command', 'key', 'revision']);
  return request;
}

export function assertOneRecoveryDeposit(before, after, studentIndex, amount) {
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.hour, before.hour);
  assert.equal(after.status, before.status);
  assert.deepEqual(after.snapshots, before.snapshots, 'Recovery must not rewrite closed reports');
  assert.equal(after.events.length, before.events.length + 1);
  assert.equal(after.audit.length, before.audit.length + 1);
  for (let i = 0; i < before.companies.length; i++) {
    const prior = before.companies[i], current = after.companies[i];
    if (i !== studentIndex % 12) { assert.deepEqual(current, prior); continue; }
    assert.equal(current.deposits.length, prior.deposits.length + 1);
    assert.equal(current.deposits.at(-1).amount, amount);
    assert.equal(current.deposits.at(-1).term, 24);
    assert.equal(current.ledger.length, prior.ledger.length + 1);
    const accounts = { ...prior.accounts, cash: prior.accounts.cash - amount, deposits: (prior.accounts.deposits || 0) + amount };
    assert.deepEqual(current.accounts, accounts);
  }
  assertInvariants(after);
}

// Compose with runEconomicScenario before each selected day's clock step.
// All mutations go through call(); persisted() is a read-only audit snapshot.
export function createRecoveryScenario(ctx) {
  const { run, students, endpoint, call, samples, checks } = ctx;
  assert.equal(students.length, 120);
  const expected = new WeakSet(), visited = new Set();
  let acceptedDecisions = 0, sequence = 0;
  const report = checks.recovery = { waves: [], faultStudents: [], intentionalFaults: { beforeSend: 0, discardedAcceptedReply: 0, inFlightAbort: 0 }, refreshedIdentities: 0 };
  const phaseRows = phase => samples.filter(sample => sample.phase === phase);
  const ordinary = phase => {
    for (const sample of phaseRows(phase)) assert.ok(sample.ms < 15000, `${phase} exceeded the browser deadline`);
  };
  const classify = (phase, status, fault) => {
    const rows = phaseRows(phase).filter(sample => sample.status === status);
    assert.ok(rows.length, `Missing measured sample for ${phase}`);
    for (const sample of rows) {
      if (fault) { assert.equal(sample.injectedFault, fault); if (fault === 'discard-response') assert.equal(sample.wireStatus, 200); }
      else { assert.equal(status, 409); ordinary(phase); }
      sample.expected = true; expected.add(sample);
    }
  };
  const ok = response => { assert.equal(response.status, 200); return response.value; };
  const requestFor = (day, revision, amount) => ({ key: `${run}-recovery-${day}-${++sequence}`, revision, command: { type: 'deposit', amount, term: 24 } });
  const post = (phase, who, request, fault) => call(phase, endpoint + '/command', who, request, 15000, fault);
  async function reconnect(day, index) {
    const who = students[index];
    if (ctx.refreshIdentity) {
      const refreshed = await ctx.refreshIdentity(who);
      if (refreshed) students[index] = refreshed;
      report.refreshedIdentities++;
    }
    const phase = `recovery-${day}-refresh-${index}`;
    const view = ok(await call(phase, endpoint, students[index], undefined, 15000)); ordinary(phase);
    assert.equal(view.state.company.id, `company-${index % 12 + 1}`);
    return view;
  }
  async function afterDay({ day, persisted }) {
    const wave = RECOVERY_DAYS.indexOf(day);
    if (wave < 0) return;
    assert.ok(!visited.has(day), 'A recovery wave must not run twice'); visited.add(day);
    const read = async () => (await persisted()).state;
    const start = await read(); assert.equal(start.status, 'paused');
    const acceptedBefore = acceptedDecisions;
    const phase = `recovery-${day}-competing-120`;
    const requests = students.map((_, i) => requestFor(day, start.revision, 10000 + wave * 120 + i));
    const burst = await Promise.all(students.map((who, i) => post(phase, who, requests[i])));
    assert.equal(burst.filter(r => r.status === 200).length, 1);
    assert.equal(burst.filter(r => r.status === 409).length, 119);
    ordinary(phase); classify(phase, 409);
    const winner = burst.findIndex(r => r.status === 200), receipt = ok(burst[winner]);
    const committed = await read(); assertOneRecoveryDeposit(start, committed, winner, requests[winner].command.amount); acceptedDecisions++;
    const duplicatePhase = `recovery-${day}-exact-retries-120`;
    const duplicates = await Promise.all(Array.from({ length: 120 }, () => post(duplicatePhase, students[winner], restorePendingRequest(JSON.stringify(requests[winner])))));
    for (const response of duplicates) assert.deepEqual(ok(response), receipt);
    ordinary(duplicatePhase); assert.deepEqual(await read(), committed, 'Exact retries changed committed state');

    const waveFaults = [];
    // Five disjoint groups of24 rotate every identity through one fault. The
    // role offset also rotates fault types across teams instead of fixing one
    // team's users to the same transport failure.
    for (let index = wave * 24; index < (wave + 1) * 24; index++) {
      const kind = (index + Math.floor(index / 12)) % 3;
      let before = await read();
      const request = requestFor(day, before.revision, 11000 + index);
      const saved = JSON.stringify(request);
      let accepted, retry, retryPhase = `recovery-${day}-retry-${index}`;
      if (kind === 0) {
        report.intentionalFaults.beforeSend++;
        // The disconnected client saves the request without issuing any I/O.
        // A separate student's accepted action makes its reviewed revision old.
        const competitor = (index + 1) % students.length;
        const competing = requestFor(day, before.revision, 12000 + index);
        const competingPhase = `recovery-${day}-offline-competitor-${index}`;
        ok(await post(competingPhase, students[competitor], competing)); ordinary(competingPhase);
        const changed = await read(); assertOneRecoveryDeposit(before, changed, competitor, competing.command.amount); acceptedDecisions++;
        await reconnect(day, index);
        const restored = restorePendingRequest(saved); assert.deepEqual(restored, request);
        const conflictPhase = `recovery-${day}-offline-stale-${index}`;
        const conflict = await post(conflictPhase, students[index], restored);
        assert.equal(conflict.status, 409); classify(conflictPhase, 409);
        // Model an explicit review, never silently rebase an uncertain result.
        const reviewPhase = `recovery-${day}-explicit-review-${index}`;
        const review = ok(await call(reviewPhase, endpoint, students[index], undefined, 15000)); ordinary(reviewPhase);
        before = await read(); assert.equal(review.state.revision, before.revision);
        retry = { ...restorePendingRequest(saved), revision: review.state.revision };
        accepted = ok(await post(retryPhase, students[index], retry)); ordinary(retryPhase);
      } else {
        const fault = kind === 1 ? 'discard-response' : 'abort-after-send';
        const faultPhase = `recovery-${day}-${fault}-${index}`;
        const lost = await post(faultPhase, students[index], request, { fault, abortAfterMs: 50 });
        assert.equal(lost.status, 0); classify(faultPhase, 0, fault);
        if (kind === 1) {
          report.intentionalFaults.discardedAcceptedReply++;
          assertOneRecoveryDeposit(before, await read(), index, request.command.amount);
        } else report.intentionalFaults.inFlightAbort++;
        await reconnect(day, index);
        retry = restorePendingRequest(saved); assert.deepEqual(retry, request, 'Reload must retain the exact uncertain request');
        accepted = ok(await post(retryPhase, students[index], retry)); ordinary(retryPhase);
      }
      const after = await read(); assertOneRecoveryDeposit(before, after, index, request.command.amount);
      assert.equal(accepted.revision, after.revision); acceptedDecisions++;
      report.faultStudents.push(index);
      waveFaults.push({ student: index, team: index % 12 + 1, fault: ['before-send', 'discard-response', 'abort-after-send'][kind], exactlyOneEffect: true });
    }
    const final = await read(), reconnectPhase = `recovery-${day}-reconnected-views-120`;
    const views = await Promise.all(students.map(who => call(reconnectPhase, endpoint, who, undefined, 15000)));
    for (let i = 0; i < views.length; i++) {
      const view = ok(views[i]).state;
      assert.equal(view.revision, final.revision); assert.equal(view.company.id, final.companies[i % 12].id);
      assert.deepEqual(view.company.accounts, final.companies[i % 12].accounts);
      assert.ok(view.companies.every(c => !Object.hasOwn(c, 'cash')));
    }
    ordinary(reconnectPhase); assert.deepEqual(final.snapshots, start.snapshots);
    const row = { day, students: 120, teams: 12, competingAccepted: 1, competingStale: 119, exactRetries: 120, faultClients: waveFaults, acceptedDecisions: acceptedDecisions - acceptedBefore, fromRevision: start.revision, toRevision: final.revision };
    report.waves.push(row); console.log(JSON.stringify({ phase: 'recovery-wave', ...row }));
    return { acceptedDecisions: row.acceptedDecisions };
  }
  return {
    afterDay,
    get acceptedDecisions() { return acceptedDecisions; },
    expectedSample: sample => expected.has(sample),
    finish() {
      assert.equal(visited.size, RECOVERY_DAYS.length);
      assert.equal(new Set(report.faultStudents).size, 120);
      assert.equal(report.intentionalFaults.beforeSend, 40);
      assert.equal(report.intentionalFaults.discardedAcceptedReply, 40);
      assert.equal(report.intentionalFaults.inFlightAbort, 40);
      report.acceptedDecisions = acceptedDecisions; report.passed = true;
      return report;
    }
  };
}
