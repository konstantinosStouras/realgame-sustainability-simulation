import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyCommand, tick, samplePoisson, publicView } from '../src/engine.mjs';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';

const teacher = { id: 'teacher', name: 'Teacher', role: 'instructor' };
const edit = (s, patch) => applyCommand(s, teacher, { type: 'catalog', collection: 'markets', id: 'local', patch });
const orders = s => s.companies.flatMap(c => c.orders);
const unitsAt = (s, hour) => orders(s).filter(o => o.createdAt === hour).reduce((sum, o) => sum + o.originalQty, 0);
function session(teams = 3) {
  const s = createSession({ companyNames: Array.from({ length: teams }, (_, i) => `Team ${i + 1}`) });
  s.catalog.markets[1].enabled = false;
  applyCommand(s, teacher, { type: 'clock', status: 'running' });
  return s;
}

test('Poisson samples have the expected mean, variance, and zero probability', () => {
  for (const lambda of [0.25, 5, 20, 1000]) {
    const s = { rng: 287401 }, n = 20000;
    let sum = 0, squares = 0, zeros = 0;
    for (let i = 0; i < n; i++) {
      const x = samplePoisson(s, lambda);
      assert.ok(Number.isSafeInteger(x) && x >= 0);
      sum += x; squares += x * x; zeros += x === 0;
    }
    const mean = sum / n, variance = squares / n - mean * mean;
    assert.ok(Math.abs(mean - lambda) < 6 * Math.sqrt(lambda / n), `mean ${mean} at λ ${lambda}`);
    assert.ok(Math.abs(variance - lambda) < 0.08 * lambda, `variance ${variance} at λ ${lambda}`);
    if (lambda <= 5) assert.ok(Math.abs(zeros / n - Math.exp(-lambda)) < 0.015);
  }
  const s = { rng: 12 };
  assert.equal(samplePoisson(s, 0), 0);
  assert.equal(s.rng, 12, 'zero demand consumes no randomness');
});

test('one hourly market draw is shared rather than multiplied by team count', () => {
  const one = session(1), three = session(3);
  edit(one, { lambda: 120 }); edit(three, { lambda: 120 });
  for (let h = 1; h <= 5; h++) {
    tick(one); tick(three);
    assert.equal(unitsAt(one, h), unitsAt(three, h));
    assert.ok(unitsAt(three, h) > 0, 'orders arrive before the old six-hour boundary');
    assert.equal(orders(three).filter(o => o.createdAt === h).length, 3);
  }
});

test('live rate edits, market disable, zero rate, and pause preserve accepted orders', () => {
  const s = session();
  edit(s, { lambda: 90 }); tick(s);
  const initial = structuredClone(orders(s));
  edit(s, { enabled: false }); tick(s); tick(s);
  assert.deepEqual(orders(s), initial);
  edit(s, { enabled: true, lambda: 0 }); tick(s);
  assert.deepEqual(orders(s), initial);
  edit(s, { lambda: 60.5 });
  const expected = samplePoisson({ rng: s.rng }, 60.5);
  tick(s);
  assert.equal(unitsAt(s, 5), expected, 're-enable samples just one hour, without backlog');
  assert.deepEqual(orders(s).filter(o => o.createdAt === 1), initial);
  for (const c of s.companies) {
    const view = publicView(s, { id: c.id, name: c.name, role: 'student', companyId: c.id });
    assert.equal(view.catalog.markets[0].lambda, 60.5);
  }
  applyCommand(s, teacher, { type: 'clock', status: 'paused' });
  const paused = structuredClone(s); tick(s);
  assert.deepEqual(s, paused);
});

test('rate validation and instructor authorization reject invalid edits without partial changes', () => {
  const s = session(), original = structuredClone(s.catalog.markets[0]);
  for (const lambda of [-1, 1000.01, Infinity, NaN, '20', null]) {
    assert.throws(() => edit(s, { enabled: false, lambda }), /Demand rate/);
    assert.deepEqual(s.catalog.markets[0], original);
  }
  assert.throws(() => edit(s, { volume: 120 }), /Use demand rate/);
  assert.throws(() => applyCommand(s, { id: 'student', role: 'student', companyId: 'company-1' }, { type: 'catalog', collection: 'markets', id: 'local', patch: { lambda: 10 } }), /Instructor access required/);
  edit(s, { lambda: 0.125 }); assert.equal(s.catalog.markets[0].lambda, 0.125);
});

test('legacy saved markets keep their six-hour draw until explicitly converted', () => {
  const s = session();
  delete s.catalog.markets[0].lambda; s.catalog.markets[0].volume = 95;
  for (let i = 0; i < 5; i++) tick(s);
  assert.equal(orders(s).length, 0);
  const rng = (Math.imul(1664525, s.rng) + 1013904223) >>> 0;
  tick(s);
  assert.equal(unitsAt(s, 6), Math.round(95 * (0.8 + 0.4 * rng / 4294967296)));
  assert.equal(s.rng, rng, 'legacy sampling preserves the original random stream');
  edit(s, { volume: 120 });
  edit(s, { lambda: 20 });
  assert.equal(Object.hasOwn(s.catalog.markets[0], 'volume'), false);
  tick(s); assert.ok(unitsAt(s, 7) > 0);
});

test('saved state and replay reproduce Poisson demand across rate changes', () => {
  const initial = session(), s = structuredClone(initial);
  const commands = [
    { type: 'catalog', collection: 'markets', id: 'local', patch: { lambda: 5.5 } },
    { type: 'tick' }, { type: 'tick' },
    { type: 'catalog', collection: 'markets', id: 'local', patch: { lambda: 72 } },
    { type: 'tick' }, { type: 'tick' }
  ];
  const run = (state, list) => { for (const cmd of list) cmd.type === 'tick' ? tick(state) : applyCommand(state, teacher, cmd); };
  run(s, commands.slice(0, 3));
  const restored = JSON.parse(JSON.stringify(s));
  run(s, commands.slice(3)); run(restored, commands.slice(3));
  run(initial, commands);
  assert.deepEqual(s, restored); assert.deepEqual(s, initial);
});

test('cloud command commits live λ for all teams, survives restart, and replays', async () => {
  let now = 0;
  const db = new MemoryFirestore(), store = new FirestoreStore(db, { now: () => now });
  const created = await store.create(teacher), id = created.id;
  const roster = await store.roster(teacher, id);
  const students = [0, 1].map(i => ({ id: `student-${i}`, name: `Student ${i}`, role: 'student' }));
  for (let i = 0; i < students.length; i++) await store.join(students[i], roster.invites[i].code);
  const command = async (key, cmd) => {
    const view = await store.view(teacher, id);
    return store.command(teacher, id, { key, revision: view.state.revision, command: cmd });
  };
  await command('poisson-start-clock', { type: 'clock', status: 'running', secondsPerHour: 4 });
  await command('poisson-live-rate', { type: 'catalog', collection: 'markets', id: 'local', patch: { lambda: 80.25 } });
  now = 4000;
  for (const student of students) {
    const { state } = await store.view(student, id);
    assert.equal(state.hour, 1); assert.equal(state.catalog.markets[0].lambda, 80.25);
    assert.ok(state.company.orders.some(o => o.marketId === 'local' && o.createdAt === 1));
  }
  await command('poisson-disable-market', { type: 'catalog', collection: 'markets', id: 'local', patch: { enabled: false } });
  now = 8000;
  const restarted = new FirestoreStore(db, { now: () => now });
  const view = await restarted.view(students[0], id);
  assert.equal(view.state.catalog.markets[0].enabled, false);
  assert.equal(view.state.company.orders.filter(o => o.marketId === 'local' && o.createdAt === 2).length, 0);
  const replay = await restarted.replay(teacher, id), replayed = structuredClone(replay.initial);
  for (const record of replay.commands) record.command.type === 'tick' ? tick(replayed) : applyCommand(replayed, record.actor, record.command, record.realAt, { replay: true });
  const actual = await restarted.view(teacher, id);
  assert.deepEqual(publicView(replayed, teacher), actual.state);
});
