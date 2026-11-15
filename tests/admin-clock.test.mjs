import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createSession, applyCommand } from '../src/engine.mjs';

const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').split('\nawait startWorkspace();')[0];
function setup() {
  const storage = { getItem: () => null }, root = {};
  const context = vm.createContext({ createSession, applyCommand, URL,
    document: { querySelector: () => root, addEventListener() {} },
    localStorage: storage, sessionStorage: storage,
    location: { hostname: 'localhost', href: 'http://localhost/' } });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run(`state = createSession(); actor = { id: 'teacher', name: 'Teacher', role: 'instructor' };
    render = () => {}; command = async cmd => applyCommand(state, actor, cmd);`);
  return { run };
}

test('teaching rates from 6 to 45 map to exactly one band, with slower rates first', () => {
  const h = setup();
  assert.equal(h.run('clockSpeedBands.length'), 6);
  for (let speed = 6; speed <= 45; speed++) {
    assert.equal(h.run(`clockSpeedBands.filter(b => ${speed} >= b.min && ${speed} <= b.max).length`), 1);
    h.run(`state.secondsPerHour = ${speed}`);
    const html = h.run('adminClock()');
    assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
    assert.match(html, new RegExp(`Clock speed: <strong>${h.run(`clockSpeedBand(${speed}).label`)}</strong>`));
  }
  assert.equal(h.run('clockSpeedBand(45).label'), 'Very slow');
  assert.equal(h.run('clockSpeedBand(6).label'), 'Very fast');
});

test('rates outside the teaching bands stay custom without selecting or changing a preset', async () => {
  const h = setup();
  for (let speed = 1; speed <= 120; speed++) {
    if (speed >= 6 && speed <= 45) continue;
    h.run(`state.secondsPerHour = ${speed}`);
    const html = h.run('adminClock()');
    assert.equal(h.run(`clockSpeedBand(${speed})`), undefined);
    assert.match(html, /Clock speed: <strong>Custom<\/strong>/);
    assert.equal((html.match(/aria-pressed="true"/g) || []).length, 0);
    assert.match(html, new RegExp(`>${speed} s/h<`));
    assert.equal(h.run('state.secondsPerHour'), speed);
  }
  await h.run("action('clock-speed', 'medium')");
  assert.equal(h.run('state.secondsPerHour'), 20);
  assert.match(h.run('adminClock()'), /Clock speed: <strong>Medium<\/strong>/);
});

test('each speed button sets its rounded midpoint without starting, pausing or advancing time', async () => {
  const h = setup();
  const expected = [['very-slow', 40], ['slow', 30], ['medium', 20], ['brisk', 14], ['fast', 10], ['very-fast', 7]];
  for (const status of ['paused', 'running']) {
    h.run(`state.status = '${status}'; state.hour = 25`);
    for (const [id, rate] of expected) {
      await h.run(`action('clock-speed', '${id}')`);
      assert.equal(h.run('state.secondsPerHour'), rate);
      assert.equal(h.run(`clockSpeedBand(${rate}).id`), id);
      assert.equal(h.run('state.status'), status);
      assert.equal(h.run('state.hour'), 25);
    }
  }
});

test('clock renders UTC date rollover, start/pause and exact custom speed', async () => {
  const h = setup();
  h.run("state.startDate = '2026-12-31T00:00:00.000Z'; state.hour = 25; state.secondsPerHour = 15");
  let html = h.run('adminClock()');
  assert.match(html, /1 Jan 2027/);
  assert.match(html, /datetime="2027-01-01T01:00:00.000Z"/);
  assert.match(html, />15 s\/h</);
  assert.match(html, />Start clock</);
  assert.match(html, /Clock speed: <strong>Brisk/);
  await h.run("action('clock', 'running')");
  html = h.run('adminClock()');
  assert.match(html, />Pause clock</);
  assert.equal((html.match(/data-action="step"[^>]*disabled/g) || []).length, 3);
  await h.run("action('clock', 'paused')");
  assert.equal(h.run('state.status'), 'paused');
});

test('completed sessions and manual-only solo mode disable speed changes', async () => {
  for (const mode of ['completed', 'solo']) {
    const h = setup();
    h.run(mode === 'solo' ? 'solo = {}' : "state.status = 'completed'");
    const before = h.run('JSON.stringify(state)');
    const html = h.run('adminClock()');
    assert.equal((html.match(/data-action="clock-speed"[^>]*disabled/g) || []).length, 6);
    assert.match(html, /data-action="clock"[^>]*disabled/);
    await h.run("action('clock-speed', 'slow')");
    assert.equal(h.run('JSON.stringify(state)'), before);
  }
});

test('unknown bands and students cannot change the clock through the speed action', async () => {
  const h = setup(), before = h.run('JSON.stringify(state)');
  await h.run("action('clock-speed', 'unknown')");
  h.run("actor.role = 'student'");
  await h.run("action('clock-speed', 'slow')");
  assert.equal(h.run('JSON.stringify(state)'), before);
});
