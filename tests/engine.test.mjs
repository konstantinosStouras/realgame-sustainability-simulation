import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyCommand, advance, assertInvariants, publicView, canMessage, balance } from '../src/engine.mjs';
const teacher = { id: 't', role: 'instructor', name: 'Teacher' };
const student = { id: 's', role: 'student', companyId: 'company-1', name: 'Student' };
const act = (s, a, who = student) => applyCommand(s, who, a);
function quiet() { const s = createSession(); for (const c of s.companies) c.shifts = [false, false, false]; for (const m of s.catalog.markets) m.enabled = false; return s; }
function order(s, qty = 50) { const c = s.companies[0]; c.orders.push({ id: 'test-order', originalQty: qty, remaining: qty, received: 0, price: 30000, payment: 24, createdAt: 0, dueAt: 48 }); return c; }

test('partial dispatch preserves original order and recognizes revenue only at receipt', () => {
  const s = quiet(), c = order(s), initial = balance(c, 'cash');
  act(s, { type: 'dispatch', orderId: 'test-order', qty: 20, routeId: 'road' });
  assert.equal(c.orders[0].originalQty, 50); assert.equal(c.orders[0].remaining, 30); assert.equal(c.orders[0].received, 0);
  assert.equal(balance(c, 'revenue'), 0); assert.equal(c.inventory.panel.qty, 160); assert.equal(balance(c, 'cash'), initial - 8500 - 20 * 320);
  const receipt = s.events.find(e => e.type === 'customerReceipt'); advance(s, receipt.at);
  assert.equal(c.orders[0].received, 20); assert.equal(balance(c, 'revenue'), -600000); assert.equal(balance(c, 'receivable'), 600000);
  advance(s, 24); assert.equal(balance(c, 'receivable'), 0); assert.equal(c.shipments[0].paidAt, s.hour); assertInvariants(s);
});
test('partial dispatch can defer freight for seven days without changing accepted terms', () => {
  const s = quiet(), c = order(s, 160);
  advance(s, 49);
  act(s, { type: 'catalog', collection: 'routes', id: 'rail', patch: { term: 168, hours: 132, reliability: 100 } }, teacher);
  const cash = balance(c, 'cash');
  act(s, { type: 'dispatch', orderId: 'test-order', qty: 70, routeId: 'rail' });
  const shipment = c.shipments[0];
  assert.equal(c.orders[0].remaining, 90);
  assert.equal(c.orders[0].originalQty, 160);
  assert.equal(balance(c, 'cash'), cash);
  assert.equal(balance(c, 'payable'), -shipment.cost);
  assert.equal(shipment.freightDueAt, 217);
  act(s, { type: 'catalog', collection: 'routes', id: 'rail', patch: { term: 0, fixed: 0 } }, teacher);
  advance(s, 167); assert.equal(shipment.freightPaidAt, null);
  advance(s, 1); assert.equal(shipment.freightPaidAt, 217);
  assert.equal(balance(c, 'payable'), 0); assertInvariants(s);
});
test('stock, quantity, funds and role validation rejects invalid decisions', () => {
  const s = quiet(), c = order(s, 1000);
  for (const qty of [0, -1, NaN, Infinity, 1.5, 181]) assert.throws(() => act(s, { type: 'dispatch', orderId: 'test-order', qty, routeId: 'road' }));
  assert.throws(() => act(s, { type: 'deposit', amount: 19000000, term: 168 }));
  assert.throws(() => act(s, { type: 'step', hours: 1 }), /Instructor/);
  assert.throws(() => act(s, { type: 'purchase', companyId: 'company-2', supplierId: 'frame-circular', qty: 10 }), /another company/);
  assert.throws(() => act(s, { type: 'purchase', supplierId: 'frame-circular', qty: 10 }, teacher), /read-only/);
  assert.equal(c.inventory.panel.qty, 180); assertInvariants(s);
});
test('supplier stock reserved once, receipt separate from payment, immutable contract terms', () => {
  const s = quiet(), c = s.companies[0], sup = s.catalog.suppliers[0], initialStock = sup.stock;
  act(s, { type: 'purchase', supplierId: sup.id, qty: 240 });
  const p = c.purchases[0]; assert.equal(sup.stock, initialStock - 240); assert.equal(c.inventory.cell.qty, 14400);
  const event = s.events.find(e => e.type === 'purchaseReceipt'), due = event.at;
  act(s, { type: 'catalog', collection: 'suppliers', id: sup.id, patch: { price: 9999, term: 0 } }, teacher);
  advance(s, due); assert.equal(c.inventory.cell.qty, 14640); assert.equal(p.paidAt, null);
  assert.equal(s.events.find(e => e.type === 'purchasePayment').at, due + 120);
  advance(s, 120); assert.equal(p.paidAt, s.hour); assert.equal(balance(c, 'payable'), 0); assertInvariants(s);
});
test('delayed investments reserve cash now but activate only at their due hour', () => {
  const s = quiet(), c = s.companies[0], initial = balance(c, 'cash');
  act(s, { type: 'invest', kind: 'efficiency' }); assert.equal(c.efficiency, 1); assert.equal(balance(c, 'cash'), initial - 2400000);
  advance(s, 47); assert.equal(c.efficiency, 1); advance(s, 1); assert.equal(c.efficiency, 0.75); assert.equal(balance(c, 'construction'), 0); assertInvariants(s);
});
test('loans fund after 24 h and deposits mature with exact simple interest', () => {
  const s = quiet(), c = s.companies[0], initial = balance(c, 'cash');
  act(s, { type: 'loan', amount: 1000000, term: 168 }); act(s, { type: 'deposit', amount: 100000, term: 24 });
  assert.equal(balance(c, 'cash'), initial - 100000); assert.equal(balance(c, 'debt'), 0);
  advance(s, 24); assert.equal(balance(c, 'debt'), -1000000); assert.equal(c.deposits[0].maturedAt, 24);
  assert.equal(balance(c, 'interestIncome'), -Math.round(100000 * 0.04 * 24 / 8760));
  advance(s, 168); assert.equal(c.loans[0].paidAt, 192); assert.equal(balance(c, 'debt'), 0); assertInvariants(s);
});
test('two-week annuity matches the observed funding delay and rounded weekly quote', () => {
  const s = quiet(), c = s.companies[0];
  act(s, { type: 'loan', plan: 'annuity', amount: 1000000, weeks: 2 });
  const loan = c.loans[0];
  assert.equal(Math.round((loan.installments[0].principal + loan.installments[0].interest) / 100), 5012);
  assert.equal(balance(c, 'debt'), 0);
  advance(s, 47); assert.equal(loan.fundedAt, null);
  advance(s, 1); assert.equal(loan.fundedAt, 48);
  advance(s, 168); assert.equal(loan.installments[0].paidAt, 216); assert.equal(loan.paidAt, null);
  advance(s, 168); assert.equal(loan.paidAt, 384);
  assert.equal(balance(c, 'debt'), 0); assertInvariants(s);
});
test('new annuity terms count repayment weeks from the request while funding remains delayed', () => {
  const s = quiet(), c = s.companies[0];
  advance(s, 24);
  act(s, { type: 'loan', plan: 'annuity', repaymentAnchor: 'request', amount: 1000000, weeks: 2 });
  const loan = c.loans[0];
  advance(s, 48);
  assert.equal(loan.fundedAt, 72);
  assert.deepEqual(s.events.filter(e => e.type === 'loanRepayment').map(e => e.at), [192, 360]);
  advance(s, 119); assert.equal(loan.installments[0].paidAt, undefined);
  advance(s, 1); assert.equal(loan.installments[0].paidAt, 192);
  advance(s, 168); assert.equal(loan.paidAt, 360);
  assert.equal(balance(c, 'debt'), 0); assertInvariants(s);
});
test('weekly deposits deduct cash immediately and accept the observed 26-week limit', () => {
  const s = quiet(), c = s.companies[0], opening = balance(c, 'cash');
  for (const weeks of [0, 1.5, 27]) assert.throws(() => act(s, { type: 'deposit', amount: 100000, weeks }));
  act(s, { type: 'deposit', amount: 100000, weeks: 1 });
  act(s, { type: 'deposit', amount: 100000, weeks: 26 });
  assert.equal(balance(c, 'cash'), opening - 200000);
  assert.deepEqual(s.events.filter(e => e.type === 'depositMaturity').map(e => e.at), [168, 4368]);
  advance(s, 168);
  assert.equal(c.deposits[0].maturedAt, 168);
  assert.equal(c.deposits[1].maturedAt, null);
  assert.equal(balance(c, 'interestIncome'), -77);
  assertInvariants(s);
});
test('unfunded repayment stays pending without duplicate interest or negative cash', () => {
  const s = quiet(), c = s.companies[0]; act(s, { type: 'loan', amount: 15000000, term: 168 }); advance(s, 24);
  // Test fixture: move all cash to deposits with balanced entry.
  const cash = balance(c, 'cash'); c.accounts.cash = 0; c.accounts.deposits = (c.accounts.deposits || 0) + cash;
  advance(s, 168); const repayment = s.events.find(e => e.type === 'loanRepayment'), interest = balance(c, 'interestPayable');
  assert.equal(repayment.status, 'pending'); assert.match(repayment.blocked, /Insufficient/);
  advance(s, 24); assert.equal(balance(c, 'interestPayable'), interest); assert.equal(balance(c, 'cash'), 0); assertInvariants(s);
});
test('daily cutoff is immutable and exact completion retains future obligations', () => {
  const s = quiet(); s.endHour = 24; act(s, { type: 'invest', kind: 'delivery' });
  advance(s, 24); assert.equal(s.status, 'completed'); assert.equal(s.snapshots.length, 1); assert.equal(s.snapshots[0].hour, 24);
  assert.ok(s.events.some(e => e.status === 'pending' && e.at > s.endHour)); assert.throws(() => advance(s, 1), /completed/);
  const snapshot = JSON.stringify(s.snapshots[0]); act(s, { type: 'configure', endHour: 72 }, teacher); advance(s, 24);
  assert.equal(JSON.stringify(s.snapshots[0]), snapshot); assert.equal(s.companies[0].investments[0].activeAt, 48);
});
test('production respects materials and machine/staff bottlenecks', () => {
  const s = createSession(), c = s.companies[0]; advance(s, 1);
  assert.equal(c.production, 12);
  assert.equal(c.inventory.cell.qty, 14400 - 12 * 32);
  assert.equal(c.inventory.frame.qty, 600 - 12);
  assert.equal(c.inventory.controller.qty, 600 - 12 * 2);
  assertInvariants(s);
  const before = c.production; c.shifts = [false, false, false]; advance(s, 1); assert.equal(c.production, before);
});
test('saved sessions without a recipe retain their historical material consumption', () => {
  const s = createSession(), c = s.companies[0];
  delete s.recipe;
  advance(s, 1);
  assert.equal(c.production, 12);
  assert.equal(c.inventory.cell.qty, 14400 - 12 * 24);
  assert.equal(c.inventory.controller.qty, 600 - 12);
  assertInvariants(s);
});
test('messaging scope and authoritative identity are preserved in views', () => {
  const s = quiet(); act(s, { type: 'message', channel: 'team:company-1', text: 'Internal', senderName: 'Spoofed' });
  assert.equal(s.messages[0].senderName, 'Student');
  assert.equal(publicView(s, { ...student, companyId: 'company-2' }).messages.length, 0);
  assert.equal(publicView(s, teacher).messages.length, 0);
  assert.throws(() => act(s, { type: 'message', channel: 'announcements', text: 'spoof' }), /access/);
  for (const channel of ['peer:company-1:company-2', 'global']) {
    const command = { type: 'message', channel, text: 'Legacy message' };
    assert.throws(() => act(s, command), { status: 403 });
    applyCommand(s, student, command, undefined, { replay: true });
  }
  assert.equal(publicView(s, student).messages.length, 1);
  assert.equal(canMessage(s, student, 'peer:company-2:company-3'), false);
  assert.equal(publicView(s, student, 'company-2').company.id, 'company-1');
  assert.equal(publicView(s, student).companies[1].accounts, undefined);
});
test('feature visibility does not grant permissions or turn off economic effects', () => {
  const s = quiet(); act(s, { type: 'configure', feature: 'purchasing', visible: true, allowed: false }, teacher);
  assert.throws(() => act(s, { type: 'purchase', supplierId: 'frame-circular', qty: 10 }), /disabled/);
  act(s, { type: 'configure', feature: 'purchasing', visible: false, allowed: true }, teacher);
  act(s, { type: 'purchase', supplierId: 'frame-circular', qty: 10 }); assert.equal(s.effects.carbonDemand, true);
});
test('seeded replay reproduces events, finances, snapshots and outcomes exactly', () => {
  const play = () => { const s = createSession({ seed: 77 }); act(s, { type: 'invest', kind: 'delivery' }); act(s, { type: 'purchase', supplierId: 'cell-circular', qty: 480 }); for (let i = 0; i < 5; i++) act(s, { type: 'step', hours: 168 }, teacher); assertInvariants(s); return s; };
  assert.deepEqual(play(), play());
});
test('automation includes incoming stock and does not repeatedly reorder', () => {
  const s = quiet(), c = s.companies[0]; act(s, { type: 'invest', kind: 'purchasing' }); act(s, { type: 'reorder', supplierId: 'frame-circular', point: 600, qty: 300, enabled: true });
  advance(s, 60); assert.equal(c.purchases.length, 1); assert.match(c.autoStatus.purchasing, /above/); assertInvariants(s);
});
test('early, exact-window and late receipts change satisfaction only at receipt', () => {
  for (const [dueAt, expected] of [[100, 0.98], [18, 1.025], [5, 0.92]]) {
    const s = quiet(), c = order(s); c.orders[0].dueAt = dueAt;
    s.catalog.routes.find(r => r.id === 'road').reliability = 100;
    act(s, { type: 'dispatch', orderId: 'test-order', qty: 10, routeId: 'road' }); assert.equal(c.satisfaction, 1);
    advance(s, 18); assert.equal(c.satisfaction, expected);
  }
});
test('active and pending energy contracts preserve their accepted standing charges', () => {
  const s = quiet(), c = s.companies[0]; act(s, { type: 'energy', energyId: 'wind' });
  act(s, { type: 'catalog', collection: 'energy', id: 'grid', patch: { daily: 999999 } }, teacher);
  act(s, { type: 'catalog', collection: 'energy', id: 'wind', patch: { daily: 999999 } }, teacher);
  assert.equal(c.energyTerms.daily, 1800); advance(s, 48); assert.equal(c.energyTerms.daily, 3200); assertInvariants(s);
});
