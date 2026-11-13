import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyCommand, assertInvariants } from '../src/engine.mjs';
import { assertEconomicState } from '../scripts/economic-checks.mjs';

const sum = (rows, field) => rows.reduce((value, row) => value + (field ? row[field] : row), 0);
const teacher = { id: 'economic-audit-instructor', name: 'Synthetic instructor', role: 'instructor' };
const students = Array.from({ length: 120 }, (_, i) => ({ id: `economic-student-${i + 1}`, name: `Synthetic student ${i + 1}`, role: 'student', companyId: `company-${Math.floor(i / 10) + 1}` }));

test('daily reconciliation rejects missing company rows, wrong cutoffs and incorrect reported inventory', () => {
  const state = createSession({ days: 3, companyNames: ['Synthetic report company'] }), initial = structuredClone(state);
  applyCommand(state, teacher, { type: 'step', hours: 48 });
  assertEconomicState(state, { initial, day: 2 });
  for (const [mutate, expected] of [
    [s => { s.snapshots[1].companies = []; }, /each company exactly once/],
    [s => { s.snapshots[0].companies.push(structuredClone(s.snapshots[0].companies[0])); }, /each company exactly once/],
    [s => { s.snapshots[0].hour = 23; }, /daily cutoff/],
    [s => { s.snapshots[1].hour = 47; }, /daily cutoff/],
    [s => { s.snapshots[1].companies[0].inventory += 999; }, /reported finished-goods inventory/],
  ]) {
    const corrupted = structuredClone(state); mutate(corrupted);
    assert.throws(() => assertEconomicState(corrupted, { initial, day: 2 }), expected);
  }
});

test('independent reconciliation detects balanced duplicate revenue and duplicate settlement events', () => {
  const state = createSession({ days: 3, companyNames: ['Synthetic audit company'] }), initial = structuredClone(state);
  applyCommand(state, students[0], { type: 'loan', amount: 100000, term: 168 });
  applyCommand(state, teacher, { type: 'step', hours: 6 });
  applyCommand(state, students[0], { type: 'dispatch', orderId: state.companies[0].orders[0].id, qty: 1, routeId: 'air' });
  applyCommand(state, teacher, { type: 'step', hours: 24 });
  assertEconomicState(state, { initial });
  const duplicateRevenue = structuredClone(state), c = duplicateRevenue.companies[0];
  const amount = c.shipments[0].revenue;
  c.ledger.push({ id: 'synthetic-corruption', hour: duplicateRevenue.hour, description: 'Synthetic duplicate revenue', lines: { receivable: amount, revenue: -amount } });
  c.accounts.receivable += amount; c.accounts.revenue -= amount;
  assertInvariants(duplicateRevenue); // Balanced double entry alone cannot detect this.
  assert.throws(() => assertEconomicState(duplicateRevenue, { initial }), /earned revenue/);
  const duplicateSettlement = structuredClone(state);
  duplicateSettlement.events.push({ ...structuredClone(duplicateSettlement.events.find(e => e.type === 'loanRepayment')), id: 'synthetic-duplicate-settlement' });
  assertInvariants(duplicateSettlement);
  assert.throws(() => assertEconomicState(duplicateSettlement, { initial }), /exactly one pending loanRepayment/);
});

for (const revenueAt of ['receipt', 'dispatch']) test(`60-day complete 12-team economy reconciles and replays (${revenueAt} accounting)`, t => {
  const state = createSession({ id: `economic-audit-${revenueAt}`, days: 60, revenueAt,
    companyNames: Array.from({ length: 12 }, (_, i) => `Synthetic team ${i + 1}`),
    inventoryStatement: 'inventory-change', dailyCorporateOverhead: 2500, dailyEnergyOverhead: 1250,
    dailyDepreciation: revenueAt === 'dispatch' ? 5000 : null,
  });
  const initial = structuredClone(state), commands = [], dailyReports = [];
  const act = (actor, command) => {
    const realAt = new Date(Date.UTC(2026, 0, 1) + commands.length * 1000).toISOString();
    applyCommand(state, actor, command, realAt);
    commands.push({ actor, command: structuredClone(command), realAt });
  };
  // Supply is shared but replenished for a twelve-company teaching economy.
  for (const supplier of state.catalog.suppliers) act(teacher, { type: 'catalog', collection: 'suppliers', id: supplier.id,
    patch: { stock: supplier.item === 'cell' ? 200000 : 10000, replenish: supplier.item === 'cell' ? 20000 : 1000 } });
  for (const route of state.catalog.routes) act(teacher, { type: 'catalog', collection: 'routes', id: route.id, patch: { term: route.id === 'air' ? 0 : 48 } });
  for (let team = 0; team < 12; team++) {
    const pupil = students.slice(team * 10, team * 10 + 10);
    for (let market = 0; market < 2; market++) act(pupil[market], { type: 'offer', offerId: `${market ? 'export' : 'local'}-standard`, price: 27000 + team * 900 + market * 1500, min: 1, max: 500, delivery: market ? 96 : 60, payment: team % 3 ? 72 : 0, enabled: true });
    act(pupil[2], { type: 'invest', kind: 'delivery' });
    act(pupil[3], { type: 'invest', kind: 'purchasing' });
    for (const [person, item, point, qty] of [[4, 'cell', 9600, 9600], [5, 'frame', 300, 300], [6, 'controller', 600, 600]]) act(pupil[person], { type: 'reorder', supplierId: `${item}-${team % 2 ? 'express' : 'circular'}`, point, qty, enabled: true });
    act(pupil[7], team % 2 ? { type: 'loan', plan: 'annuity', repaymentAnchor: 'request', amount: 1000000, weeks: 4 } : { type: 'loan', amount: 1000000, term: 336 });
    act(pupil[8], { type: 'deposit', amount: 100000, weeks: 1 });
    act(pupil[9], { type: 'shifts', shifts: [true, team % 4 === 0, false] });
    if (team % 3) act(pupil[9], { type: 'energy', energyId: team % 3 === 1 ? 'wind' : 'solar' });
  }
  for (let day = 0; day < 60; day++) {
    if (day === 1) for (let team = 0; team < 12; team++) {
      const order = state.companies[team].orders[0];
      act(students[team * 10], { type: 'dispatch', orderId: order.id, qty: 2, routeId: 'air' });
    }
    if (day === 7) for (let team = 0; team < 12; team++) act(students[team * 10 + 3], { type: 'invest', kind: 'efficiency' });
    if (day === 20) for (let team = 0; team < 12; team++) {
      act(students[team * 10 + 5], { type: 'budget', marketing: 1500 + team * 100, research: 1000 });
      const offer = state.companies[team].offers[0];
      act(students[team * 10 + 1], { type: 'offer', offerId: offer.id, price: 32000 + team * 500, min: 1, max: 500, delivery: 60, payment: offer.payment, enabled: true });
    }
    act(teacher, { type: 'step', hours: 24 });
    assertEconomicState(state, { initial, day: day + 1 });
    dailyReports.push(structuredClone(state.snapshots.at(-1)));
  }
  assert.equal(state.status, 'completed');
  assert.deepEqual(state.snapshots, dailyReports, 'later economic activity cannot rewrite earlier daily closes');
  assert.equal(new Set(commands.filter(row => row.actor.role === 'student').map(row => row.actor.id)).size, 120);
  for (const c of state.companies) {
    assert.ok(c.production > 500 && c.received > 500, `${c.id}: substantive manufacturing and sales`);
    assert.ok(c.purchases.some(p => p.paidAt != null), `${c.id}: supplier settlements exercised`);
    assert.ok(c.shipments.some(sh => sh.paidAt != null), `${c.id}: customer collections exercised`);
    assert.ok(c.shipments.some(sh => sh.freightPaidAt != null), `${c.id}: freight settlements exercised`);
    assert.ok(c.loans.every(l => l.paidAt != null), `${c.id}: bank principal settled`);
    assert.ok(c.deposits.every(d => d.maturedAt != null), `${c.id}: deposits matured`);
  }
  const replay = structuredClone(initial);
  for (const { actor, command, realAt } of commands) applyCommand(replay, actor, command, realAt, { replay: true });
  assert.deepEqual(replay, state, 'all economic history, reports and journal entries replay exactly');
  t.diagnostic(JSON.stringify({ revenueAt, days: 60, students: 120, commands: commands.length, reports: state.snapshots.length,
    production: sum(state.companies, 'production'), received: sum(state.companies, 'received'),
    purchases: sum(state.companies.map(c => c.purchases.length)), shipments: sum(state.companies.map(c => c.shipments.length)),
    supplierPayments: sum(state.companies.map(c => c.purchases.filter(p => p.paidAt != null).length)),
    customerPayments: sum(state.companies.map(c => c.shipments.filter(sh => sh.paidAt != null).length)),
  }));
});
