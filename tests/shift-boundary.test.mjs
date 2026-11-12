import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyCommand, advance, assertInvariants, balance, profit } from '../src/engine.mjs';

const student = { id: 'student', name: 'Student', role: 'student', companyId: 'company-1' };
const morning = [true, false, false], evening = [false, false, true];
function session(shifts) {
  const s = createSession({ companyNames: ['Shift test'] });
  s.companies[0].shifts = [...shifts];
  for (const market of s.catalog.markets) market.enabled = false;
  return s;
}
function change(s, shifts) {
  applyCommand(s, student, { type: 'shifts', shifts: [...shifts] });
  return s.events.find(e => e.type === 'shifts' && e.status === 'pending');
}
function closeMatchesLive(s, expectedProduction) {
  const c = s.companies[0], snap = s.snapshots.at(-1);
  assert.equal(snap.hour, s.hour);
  const row = snap.companies[0];
  assert.equal(row.production, expectedProduction);
  assert.equal(row.production, c.production);
  assert.equal(row.inventory, 180 + expectedProduction);
  assert.equal(row.cash, balance(c, 'cash'));
  assert.equal(row.profit, profit(c));
  assert.equal(row.energyKwh, c.energyKwh);
  assert.equal(row.energyCost, c.energyCost);
  assert.equal(row.emissions, c.emissions);
  assertInvariants(s);
  return structuredClone(snap);
}

test('00–08 to 16–24 at hour 8 retains the final morning hour and uses the new evening shift', () => {
  const s = session(morning), c = s.companies[0];
  advance(s, 7);
  assert.equal(c.production, 84);
  const event = change(s, evening), cash = balance(c, 'cash');
  assert.equal(event.at, 8);
  advance(s, 1);
  assert.equal(c.production, 96);
  assert.equal(cash - balance(c, 'cash'), 10800 + 12 * 3 * 17);
  assert.equal(event.completedAt, 8);
  assert.deepEqual(c.shifts, evening);
  assertInvariants(s);
  advance(s, 8);
  assert.equal(c.production, 96, '08–16 is inactive under the newly applied schedule');
  advance(s, 1);
  assert.equal(c.production, 108, '16–17 is the first completed evening hour');
  advance(s, 7);
  closeMatchesLive(s, 192);
  assert.equal(c.energyKwh, 192 * 3);
  assert.equal(c.energyCost, 96 * 3 * 17 + 96 * 3 * 14);
  assert.equal(c.ledger.filter(e => e.description === 'Active shift wages').length, 16);
});

test('16–24 to 00–08 at hour 24 retains the final evening hour in the immutable daily close', () => {
  const s = session(evening), c = s.companies[0];
  advance(s, 23);
  assert.equal(c.production, 84);
  const event = change(s, morning);
  assert.equal(event.at, 24);
  advance(s, 1);
  assert.equal(event.completedAt, 24);
  assert.deepEqual(c.shifts, morning);
  assert.equal(c.energyCost, 96 * 3 * 14);
  const firstDay = closeMatchesLive(s, 96);
  advance(s, 1);
  assert.equal(c.production, 108, 'the next interval uses the new morning schedule');
  assertInvariants(s);
  advance(s, 23);
  closeMatchesLive(s, 192);
  assert.equal(c.energyCost, 96 * 3 * 14 + 96 * 3 * 17);
  assert.deepEqual(s.snapshots[0], firstDay, 'advancing never rewrites the preceding daily close');
});

test('enabling a closing shift at its boundary does not manufacture a retroactive hour', () => {
  const s = session(evening), c = s.companies[0];
  advance(s, 7);
  change(s, morning);
  advance(s, 1);
  assert.deepEqual(c.shifts, morning);
  assert.equal(c.production, 0);
  assert.equal(c.energyKwh, 0);
  assert.equal(c.ledger.filter(e => e.description === 'Active shift wages').length, 0);
  assertInvariants(s);
  advance(s, 16);
  closeMatchesLive(s, 0);
  advance(s, 1);
  assert.equal(c.production, 12, 'the new morning shift first runs the next day');
  assertInvariants(s);
});

test('shift eligibility is preserved without moving other due events after production or daily close', () => {
  const s = session(evening), c = s.companies[0];
  applyCommand(s, student, { type: 'energy', energyId: 'solar' });
  const energyEvent = s.events.find(e => e.type === 'energy');
  assert.equal(energyEvent.at, 24);
  advance(s, 23);
  const shiftEvent = change(s, morning), energyCost = c.energyCost;
  advance(s, 1);
  assert.equal(energyEvent.completedAt, 24);
  assert.equal(shiftEvent.completedAt, 24);
  assert.equal(c.energy, 'solar');
  assert.equal(c.production, 96);
  assert.equal(c.energyCost - energyCost, 12 * 3 * 22, 'energy activation still precedes this tick’s production');
  const overhead = c.ledger.find(e => e.hour === 24 && e.description.startsWith('Daily rent'));
  assert.equal(overhead.lines.expense, 35000 + 2400, 'daily close uses the newly activated contract');
  closeMatchesLive(s, 96);
});
