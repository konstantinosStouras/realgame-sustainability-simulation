import assert from 'node:assert/strict';
import { assertInvariants, balance, inventoryStatementValues, productionRecipe, forecast } from '../src/engine.mjs';
const sum = (rows, field) => rows.reduce((value, row) => value + (field ? row[field] : row), 0);

// Reconcile source contracts and quantities independently of the engine's basic
// balanced-ledger invariant. A balanced but duplicated posting must fail here.
export function assertEconomicState(state, { initial, day } = {}) {
  assert.ok(initial?.companies, "The opening state is required for independent reconciliation");
  if (day !== undefined) {
    assert.equal(state.hour, day * 24);
    assert.equal(state.snapshots.length, day);
    const companyIds = state.companies.map(c => c.id).sort();
    for (let index = 0; index < state.snapshots.length; index++) {
      const snapshot = state.snapshots[index];
      assert.equal(snapshot.hour, (index + 1) * 24, 'Every daily cutoff must be present and chronological');
      assert.deepEqual(snapshot.companies.map(c => c.id).sort(), companyIds, 'Every daily report must contain each company exactly once');
    }
  }
  assertInvariants(state);
  const recipe = productionRecipe(state);
  for (const c of state.companies) {
    const opening = initial.companies.find(x => x.id === c.id);
    const journal = {};
    for (const entry of c.ledger) {
      assert.equal(sum(Object.values(entry.lines)), 0, entry.description);
      for (const [account, amount] of Object.entries(entry.lines)) {
        assert.ok(Number.isSafeInteger(amount), entry.description);
        journal[account] = (journal[account] || 0) + amount;
      }
    }
    assert.deepEqual(journal, c.accounts, `${c.id}: journal and balances`);
    const recognized = c.shipments.filter(sh => sh.recognizedAt != null || sh.receivedAt != null);
    assert.equal(-balance(c, 'revenue') || 0, sum(recognized, 'revenue'), `${c.id}: earned revenue`);
    assert.equal(balance(c, 'cogs'), sum(recognized, 'stockValue'), `${c.id}: recognized stock cost`);
    assert.equal(balance(c, 'receivable'), sum(recognized.filter(sh => sh.paidAt == null), 'revenue'), `${c.id}: unpaid customer balance`);
    assert.equal(balance(c, 'transit'), sum(c.shipments.filter(sh => sh.recognizedAt == null && sh.receivedAt == null), 'stockValue'), `${c.id}: unrecognized transit`);
    assert.equal(balance(c, 'inbound'), sum(c.purchases.filter(p => p.receivedAt == null), 'cost'), `${c.id}: unreceived purchases`);
    const unpaidFreight = c.shipments.filter(sh => sh.freightDueAt != null && sh.freightPaidAt == null);
    assert.equal(-balance(c, 'payable') || 0, sum(c.purchases.filter(p => p.paidAt == null), 'cost') + sum(unpaidFreight, 'cost'), `${c.id}: supplier and freight payables`);
    assert.equal(balance(c, 'deposits'), sum(c.deposits.filter(d => d.maturedAt == null), 'amount'), `${c.id}: deposit principal`);
    assert.equal(-balance(c, 'interestIncome') || 0, sum(c.deposits.filter(d => d.maturedAt != null), 'interest'), `${c.id}: matured deposit interest`);
    const outstandingPrincipal = sum(c.loans.filter(l => l.fundedAt != null).map(l => l.installments
      ? sum(l.installments.filter(part => part.paidAt == null), 'principal')
      : l.paidAt == null ? l.amount : 0));
    assert.equal(-balance(c, 'debt') || 0, outstandingPrincipal, `${c.id}: remaining funded principal`);
    const accruedInterest = sum(state.events.filter(e => e.companyId === c.id && e.type === 'loanRepayment' && e.accrued && e.status === 'pending').map(e => {
      const loan = c.loans.find(l => l.id === e.data.loanId);
      return loan.installments?.[e.data.installment]?.interest ?? loan.interest;
    }));
    assert.equal(-balance(c, 'interestPayable') || 0, accruedInterest, `${c.id}: unpaid accrued interest`);
    assert.equal(balance(c, 'construction'), sum(c.investments.filter(i => i.activeAt == null), 'cost'), `${c.id}: prepaid capacity`);
    const depreciated = sum(c.ledger.filter(e => e.description.startsWith('Daily depreciation')).map(e => -e.lines.fixedAssets));
    assert.equal(balance(c, 'fixedAssets'), balance(opening, 'fixedAssets') + sum(c.investments.filter(i => i.activeAt != null), 'cost') - depreciated, `${c.id}: capital and depreciation`);
    const received = c.purchases.filter(p => p.receivedAt != null);
    for (const [item, count] of Object.entries(recipe)) {
      assert.equal(c.inventory[item].qty, opening.inventory[item].qty + sum(received.filter(p => p.item === item), 'qty') - c.production * count, `${c.id}: ${item} physical flow`);
    }
    assert.equal(c.inventory.panel.qty, opening.inventory.panel.qty + c.production - sum(c.shipments, 'qty'), `${c.id}: finished goods physical flow`);
    assert.equal(c.received, sum(c.shipments.filter(sh => sh.receivedAt != null), 'qty'));
    assert.equal(c.receivedValue, sum(c.shipments.filter(sh => sh.receivedAt != null), 'revenue'));
    const statement = inventoryStatementValues(c);
    assert.equal(statement.purchases - statement.inventoryChange, balance(c, 'cogs'), `${c.id}: alternative income statements reconcile`);
    assert.equal(c.energyCost, sum(c.ledger.filter(e => ['Production electricity', 'Daily energy overhead'].includes(e.description)).map(e => e.lines.expense)), `${c.id}: electricity report`);
    const pending = state.events.filter(e => e.companyId === c.id && e.status === 'pending');
    const obligations = [];
    const expectObligation = (type, key, id, amount, extra = () => true) => {
      const matches = pending.filter(e => e.type === type && e.data[key] === id && extra(e));
      assert.equal(matches.length, 1, `${c.id}: exactly one pending ${type} for ${id}`);
      obligations.push({ eventId: matches[0].id, hour: matches[0].at, amount });
    };
    for (const p of c.purchases) if (p.receivedAt != null && p.paidAt == null) expectObligation('purchasePayment', 'purchaseId', p.id, -p.cost);
    for (const sh of c.shipments) {
      if (sh.receivedAt != null && sh.paidAt == null) expectObligation('customerPayment', 'shipmentId', sh.id, sh.revenue);
      if (sh.freightDueAt != null && sh.freightPaidAt == null) expectObligation('freightPayment', 'shipmentId', sh.id, -sh.cost);
    }
    for (const l of c.loans) {
      if (l.fundedAt == null) expectObligation('loanFunding', 'loanId', l.id, l.amount);
      else if (l.installments) {
        l.installments.forEach((part, index) => {
          if (part.paidAt == null) expectObligation('loanRepayment', 'loanId', l.id, -part.principal - part.interest, e => e.data.installment === index);
        });
      } else if (l.paidAt == null) expectObligation('loanRepayment', 'loanId', l.id, -l.amount - l.interest);
    }
    for (const d of c.deposits) if (d.maturedAt == null) expectObligation('depositMaturity', 'depositId', d.id, d.amount + d.interest);
    // Match event identity as well as amount: equal-value duplicate or missing
    // settlements must not cancel each other out in a forecast total.
    const byEvent = (a, b) => a.eventId.localeCompare(b.eventId);
    const actualForecast = forecast(state, c).map(({ eventId, hour, amount }) => ({ eventId, hour, amount }));
    assert.deepEqual(actualForecast.sort(byEvent), obligations.filter(o => o.amount).sort(byEvent), `${c.id}: forecast matches unsettled contracts`);
    const report = state.snapshots.at(-1)?.companies.find(row => row.id === c.id);
    if (day !== undefined && day > 0) assert.ok(report, `${c.id}: latest daily report is required`);
    if (report && state.snapshots.at(-1).hour === state.hour) {
      assert.equal(report.cash, journal.cash);
      assert.equal(report.revenue || 0, -journal.revenue || 0);
      assert.equal(report.profit, -(journal.revenue || 0) - (journal.interestIncome || 0) - (journal.cogs || 0) - (journal.expense || 0));
      assert.equal(report.inventory, c.inventory.panel.qty, `${c.id}: reported finished-goods inventory`);
      for (const key of ['production', 'energyCost', 'energyKwh', 'emissions', 'dispatched', 'received', 'demandUnits']) assert.equal(report[key], c[key]);
      const totalReceived = sum(state.companies, 'received');
      assert.equal(report.marketShare, totalReceived ? c.received / totalReceived * 100 : 0);
    }
  }
}
