import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyCommand, publicView } from '../src/engine.mjs';
import { operationalReports, buildOperationalReport, businessUpdates } from '../src/operational-reports.mjs';

const teacher = { id: 't', name: 'Teacher', role: 'instructor' };
const student = { id: 's', name: 'Student', role: 'student', companyId: 'company-1' };
function fixture() {
  const s = createSession({ seed: 420, days: 30 });
  applyCommand(s, student, { type: 'purchase', supplierId: 'cell-circular', qty: 240 });
  applyCommand(s, teacher, { type: 'step', hours: 6 });
  const order = s.companies[0].orders.find(o => o.originalQty > 2);
  applyCommand(s, student, { type: 'dispatch', orderId: order.id, routeId: 'air', qty: 2 });
  applyCommand(s, teacher, { type: 'step', hours: 18 });
  return s;
}
test('every menu report builds a rectangular table from authorized data without mutation', () => {
  const s = fixture(), view = publicView(s, student), before = JSON.stringify(view);
  for (const id of Object.keys(operationalReports)) {
    const report = buildOperationalReport(view, id);
    assert.ok(report.columns.length, id);
    for (const row of report.rows) {
      assert.equal(row.length, report.columns.length, id);
      assert.ok(row.every(value => typeof value !== 'number' || Number.isFinite(value)), id);
    }
  }
  assert.equal(JSON.stringify(view), before);
});
test('delivery reports distinguish original orders, partial dispatch, actual arrival and money', () => {
  const s = fixture(), view = publicView(s, student), shipment = view.company.shipments[0];
  let report = buildOperationalReport(view, 'deliveries');
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0][6], 2);
  assert.equal(report.rows[0][8], shipment.revenue);
  assert.equal(report.rows[0][12], shipment.receivedAt);
  assert.equal(report.rows[0][16], shipment.carbon / 2);
  assert.equal(buildOperationalReport(view, 'arrivals').rows.length, 1);
  shipment.receivedAt = null;
  assert.equal(buildOperationalReport(view, 'arrivals').rows.length, 0);
  assert.equal(buildOperationalReport(view, 'deliveries').rows.length, 1);
  const order = view.company.orders.find(o => o.id === shipment.orderId);
  assert.ok(order.originalQty > shipment.qty);
  assert.equal(order.remaining + shipment.qty, order.originalQty);
});
test('date and market filters use the lifecycle timestamp rather than scheduled arrival', () => {
  const view = publicView(fixture(), student), sh = view.company.shipments[0], order = view.company.orders.find(o => o.id === sh.orderId);
  view.hour = 200; sh.dispatchedAt = 20; sh.expectedAt = 40; sh.receivedAt = 100;
  assert.equal(buildOperationalReport(view, 'deliveries', { days: 7 }).rows.length, 0);
  assert.equal(buildOperationalReport(view, 'arrivals7').rows.length, 1);
  assert.equal(buildOperationalReport(view, 'arrivals7', { market: order.marketId === 'local' ? 'export' : 'local' }).rows.length, 0);
  sh.receivedAt = 32;
  assert.equal(buildOperationalReport(view, 'arrivals7').rows.length, 0, 'strict rolling lower boundary');
});
test('balance sheet reconciles and forecast accumulates only committed scheduled cash events', () => {
  const view = publicView(fixture(), student);
  const balance = buildOperationalReport(view, 'balance');
  assert.equal(balance.rows.find(r => r[1] === 'Total assets')[2], balance.rows.at(-1)[2]);
  let cash = view.company.accounts.cash;
  const forecast = buildOperationalReport(view, 'cashflow');
  forecast.rows.forEach((row, i) => { cash += view.company.forecast[i].amount; assert.equal(row[3], cash); });
});
test('component stock history reconstructs daily balances after receipts and production', () => {
  const s = fixture(); applyCommand(s, teacher, { type: 'step', hours: 48 });
  const view = publicView(s, student), rows = buildOperationalReport(view, 'stockHistory').rows.filter(r => r[0] === s.hour);
  for (const [key, name] of [['cell', 'Photo cell'], ['frame', 'Recycled frame'], ['controller', 'Junction box'], ['panel', 'Solar panel']]) assert.equal(rows.find(r => r[1] === name)[2], view.company.inventory[key].qty);
});
test('shared reports use closed snapshots and do not expose competitor transactions', () => {
  const s = fixture(); s.companies[1].orders[0].customer = 'PRIVATE-CUSTOMER';
  const view = publicView(s, student), snapshot = view.snapshots.at(-1);
  view.company.accounts.cash += 12345;
  assert.equal(buildOperationalReport(view, 'companyIncome').rows[0][2], snapshot.companies[0].revenue);
  for (const id of Object.keys(operationalReports)) assert.ok(!JSON.stringify(buildOperationalReport(view, id)).includes('PRIVATE-CUSTOMER'));
  assert.match(buildOperationalReport(view, 'marketShares').note, /Per-market competitor shares are not recorded/);
});
test('empty output never fabricates efficiency or average costs', () => {
  const view = publicView(createSession(), student);
  assert.equal(buildOperationalReport(view, 'productionCost').rows[0][4], null);
  assert.equal(buildOperationalReport(view, 'deliveries').rows.length, 0);
  assert.equal(buildOperationalReport(view, 'companyIncome').rows.length, 0);
  assert.match(buildOperationalReport({ ...view, company: null }, 'orders').note, /Select a company/);
});
test('delivery notes distinguish estimates from actual early, on-time and late arrivals', () => {
  const view = publicView(fixture(), student), shipment = view.company.shipments[0];
  const order = view.company.orders.find(o => o.id === shipment.orderId);
  shipment.expectedAt = order.dueAt - 25; shipment.receivedAt = null;
  let notes = businessUpdates(view, true);
  assert.equal(notes.length, 1); assert.match(notes[0].title, /Expected: early/);
  assert.match(notes[0].text, /Transit delays/);
  shipment.receivedAt = order.dueAt + 2;
  notes = businessUpdates(view, true);
  assert.equal(notes.length, 2); assert.equal(notes[0].title, 'late delivery');
  assert.match(notes[0].text, /actual customer receipt/);
  shipment.receivedAt = order.dueAt - 24;
  assert.equal(businessUpdates(view, true)[0].severity, 'success');
  assert.ok(businessUpdates(view).length >= notes.length);
});
