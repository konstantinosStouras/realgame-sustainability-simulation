import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createSession, applyCommand, advance, assertInvariants, publicView, canMessage, balance, profit, forecast } from '../src/engine.mjs';

const teacher = { id: 'synthetic-instructor', name: 'Synthetic instructor', role: 'instructor' };
const pupils = Array.from({ length: 96 }, (_, i) => ({
  id: `synthetic-student-${i + 1}`, name: `Synthetic student ${i + 1}`,
  role: 'student', companyId: `company-${Math.floor(i / 8) + 1}`,
}));
const classroom = days => createSession({ days, companyNames: Array.from({ length: 12 }, (_, i) => `Synthetic team ${i + 1}`) });

test('prototype-property names are validation errors, never internal server errors', () => {
  const s = classroom(1);
  for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    for (const [actor, command] of [
      [pupils[0], { type: key }],
      [pupils[0], { type: 'invest', kind: key }],
      [teacher, { type: 'catalog', collection: key, id: 'cell-circular', patch: {} }],
      [teacher, { type: 'catalog', collection: 'suppliers', id: 'cell-circular', patch: { [key]: 1 } }],
    ]) {
      const next = structuredClone(s);
      assert.throws(() => applyCommand(next, actor, command), error => error.status === 400,
        `Expected a client validation error for ${JSON.stringify(command)}`);
      assert.equal(next.audit.length, 0);
      assert.equal(next.events.length, 0);
      assert.equal(next.revision, 0);
      assert.deepEqual(next.companies.map(c => c.accounts), s.companies.map(c => c.accounts));
      assertInvariants(next);
    }
  }
  for (const key of [null, ['delivery'], { toString: null }]) {
    assert.throws(() => applyCommand(structuredClone(s), pupils[0], { type: 'invest', kind: key }), error => error.status === 400);
    assert.throws(() => applyCommand(structuredClone(s), teacher, { type: 'catalog', collection: key, id: 'cell-circular', patch: {} }), error => error.status === 400);
  }
  assert.throws(() => applyCommand(structuredClone(s), teacher, { type: 'catalog', collection: 'suppliers', id: 'cell-circular', patch: [] }), error => error.status === 400);
});

// Frozen pre-optimization behavior: compatibility covers role filtering and every
// output field, while the implementation avoids cloning unauthorized histories.
function previousPublicView(s, actor, previewId) {
  const view = structuredClone(s), isTeacher = actor.role === 'instructor';
  const companyId = isTeacher ? previewId : actor.companyId;
  view.company = view.companies.find(c => c.id === companyId) || null;
  if (view.company) { view.company.profit = profit(view.company); view.company.forecast = forecast(s, view.company); }
  view.companies = view.companies.map(c => ({ id: c.id, name: c.name, ...(isTeacher ? {
    cash: balance(c, 'cash'), profit: profit(c), inventory: c.inventory.panel.qty,
    openUnits: c.orders.reduce((n, o) => n + o.remaining, 0), emissions: c.emissions,
  } : {}) }));
  view.events = view.events.filter(e => isTeacher || e.companyId === companyId);
  view.messages = view.messages.filter(m => canMessage(s, actor, m.channel));
  view.audit = view.audit.filter(a => isTeacher || a.companyId === companyId).map(a => ({ ...a, command: a.command.type === 'message' ? { type: 'message' } : a.command }));
  delete view.rng; delete view.sequence;
  return view;
}

test('filtered views preserve the response contract and isolate all nested state', () => {
  const s = classroom(3);
  for (const actor of pupils.filter((_, i) => i % 8 === 0)) {
    applyCommand(s, actor, { type: 'loan', amount: 100000, term: 168 });
    applyCommand(s, actor, { type: 'message', channel: `team:${actor.companyId}`, text: `Private ${actor.companyId}` });
    applyCommand(s, actor, { type: 'message', channel: `teacher:${actor.companyId}`, text: `Instructor conversation ${actor.companyId}` });
  }
  applyCommand(s, teacher, { type: 'message', channel: 'announcements', text: 'Synthetic announcement' });
  advance(s, 24);
  const original = structuredClone(s);
  for (const [actor, preview] of [[teacher, undefined], [teacher, 'company-2'], [pupils[0], undefined], [pupils[8], 'company-1']]) {
    const view = publicView(s, actor, preview);
    assert.deepEqual(view, previousPublicView(s, actor, preview));
    view.catalog.suppliers[0].stock = -1;
    view.accounting.revenueAt = 'changed';
    view.snapshots[0].companies[0].cash = -1;
    view.messages[0].text = 'changed';
    view.events[0].data.loanId = 'changed';
    view.audit[0].command.amount = -1;
    view.features.offers.allowed = false;
    if (view.company) {
      view.company.accounts.cash = -1;
      view.company.inventory.panel.qty = -1;
      view.company.ledger[0].lines.cash = -1;
      view.company.loans[0].amount = -1;
      view.company.forecast[0].amount = -1;
    }
    assert.deepEqual(s, original, 'A returned view must not mutate authoritative state');
  }
});

test('12 competing teams and 96 synthetic students complete the 180-day limit', t => {
  const s = classroom(180), started = performance.now();
  let accepted = 0, rejected = 0;
  const act = (actor, command) => {
    try { applyCommand(s, actor, command); accepted++; }
    catch (error) { assert.equal(error.status, 400, error.message); rejected++; }
  };
  for (let team = 0; team < 12; team++) {
    const actor = pupils[team * 8];
    for (const kind of ['delivery', 'purchasing']) act(actor, { type: 'invest', kind });
    for (const [item, point, qty] of [['cell', 9600, 9600], ['frame', 300, 300], ['controller', 600, 600]])
      act(actor, { type: 'reorder', supplierId: `${item}-circular`, point, qty, enabled: true });
    act(actor, { type: 'loan', plan: 'annuity', repaymentAnchor: 'request', amount: 1000000, weeks: 10 });
    act(actor, { type: 'deposit', amount: 100000, weeks: 1 });
    if (team % 2) act(actor, { type: 'energy', energyId: 'wind' });
  }
  for (let day = 0; day < 180; day++) {
    for (let team = 0; team < 12; team++) {
      const students = pupils.slice(team * 8, team * 8 + 8);
      for (let market = 0; market < 2; market++) act(students[market], {
        type: 'offer', offerId: `${market ? 'export' : 'local'}-standard`,
        price: 24000 + team * 700 + (day % 7) * 100, min: 1, max: 500,
        delivery: 60 + market * 36, payment: 72, enabled: true,
      });
      act(students[2], { type: 'purchase', supplierId: 'cell-circular', qty: 480 });
      act(students[3], { type: 'purchase', supplierId: 'frame-circular', qty: 10 });
      act(students[4], { type: 'purchase', supplierId: 'controller-circular', qty: 24 });
      act(students[5], { type: 'budget', marketing: team * 100, research: team * 50 });
      act(students[6], { type: 'message', channel: `team:${students[6].companyId}`, text: `Synthetic day ${day + 1} plan` });
      act(students[7], { type: 'shifts', shifts: [true, team % 3 === 0, false] });
    }
    advance(s, 24);
    assertInvariants(s);
    for (const supplier of s.catalog.suppliers) assert.ok(supplier.stock >= 0);
    for (const c of s.companies) {
      assert.ok(c.satisfaction >= 0.3 && c.satisfaction <= 1.3);
      assert.ok(c.workers >= 1 && c.workers <= 80);
      assert.equal(c.orders.reduce((n, o) => n + o.originalQty, 0), c.demandUnits);
      assert.equal(c.shipments.reduce((n, sh) => n + sh.qty, 0), c.dispatched);
      assert.equal(c.shipments.filter(sh => sh.receivedAt !== null).reduce((n, sh) => n + sh.qty, 0), c.received);
    }
  }
  assert.equal(s.hour, 4320);
  assert.equal(s.status, 'completed');
  assert.equal(s.snapshots.length, 180);
  assert.deepEqual(s.snapshots.map(x => x.hour), Array.from({ length: 180 }, (_, i) => (i + 1) * 24));
  assert.ok(accepted > 10000);
  assert.ok(rejected > 0, 'Scarce shared inventory and exhausted credit should reject some purchases');
  assert.equal(new Set(s.audit.filter(a => a.role === 'student').map(a => a.actorId)).size, 96);
  for (const actor of pupils) {
    const view = publicView(s, actor);
    assert.equal(view.company.id, actor.companyId);
    assert.ok(view.companies.every(c => Object.keys(c).sort().join(',') === 'id,name'));
    assert.ok(view.events.every(e => e.companyId === actor.companyId));
    assert.ok(view.messages.every(m => m.channel === `team:${actor.companyId}`));
    assert.ok(view.audit.every(a => a.companyId === actor.companyId));
    assert.ok(view.audit.filter(a => a.command.type === 'message').every(a => !('text' in a.command)));
    assert.ok(!('rng' in view) && !('sequence' in view));
  }
  assert.throws(() => applyCommand(s, pupils[0], { type: 'purchase', supplierId: 'frame-circular', qty: 10 }), /completed/);
  t.diagnostic(JSON.stringify({ students: 96, teams: 12, days: 180, accepted, rejected,
    orders: s.companies.reduce((n, c) => n + c.orders.length, 0), shipments: s.companies.reduce((n, c) => n + c.shipments.length, 0),
    events: s.events.length, elapsedMs: Math.round(performance.now() - started) }));
});

test('order conservation catches corrupt partial shipments after aggregate validation', () => {
  const s = classroom(1);
  advance(s, 6);
  const c = s.companies[0], order = c.orders[0];
  applyCommand(s, pupils[0], { type: 'dispatch', orderId: order.id, qty: 1, routeId: 'road' });
  assertInvariants(s);
  order.remaining++;
  assert.throws(() => assertInvariants(s), /Order conservation/);
  order.remaining--;
  order.received = 2;
  assert.throws(() => assertInvariants(s), /Order conservation/);
});
