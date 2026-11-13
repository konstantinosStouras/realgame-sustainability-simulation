import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
function harness() {
  const handlers = {}, tooltip = { hidden: true, textContent: '' };
  const chart = {
    querySelector: () => tooltip,
    querySelectorAll: selector => selector.includes('is-highlighted') ? points.filter(p => p.active) : points,
    contains: target => points.includes(target)
  };
  const points = [0, 1].map(i => ({
    active: false,
    closest: () => chart,
    matches: () => true,
    getAttribute: () => `Company ${i} · 4 Jan · ${i + 1} EUR`,
    getBoundingClientRect: () => ({x: 50 + i * 50, y: 100, width: 6, height: 6}),
    classList: { add() { points[i].active = true; }, remove() { points[i].active = false; } }
  }));
  const context = vm.createContext({ document: { addEventListener: (type, fn) => handlers[type] = fn, querySelectorAll: () => [chart] } });
  vm.runInContext(source.slice(source.indexOf('function hideChartTooltip('), source.indexOf('function pendingEvents(')), context);
  return { handlers, tooltip, points, chart };
}
test('hover selects the nearest point with a generous hit area and clears distant values', () => {
  const h = harness();
  h.handlers.pointermove({pointerType:'mouse', target:h.points[0], clientX:110, clientY:110});
  assert.match(h.tooltip.textContent, /Company 1/);
  assert.equal(h.tooltip.hidden, false);
  assert.equal(h.points[1].active, true);
  h.handlers.pointermove({pointerType:'mouse', target:h.points[0], clientX:200, clientY:200});
  assert.equal(h.tooltip.hidden, true);
  assert.equal(h.points[1].active, false);
});
test('touch click and keyboard focus expose values; Escape and focus exit dismiss them', () => {
  const h = harness();
  h.handlers.click({target:h.points[0], clientX:53, clientY:103});
  assert.match(h.tooltip.textContent, /Company 0/);
  h.handlers.focusin({target:h.points[1]});
  assert.match(h.tooltip.textContent, /Company 1/);
  h.handlers.keydown({key:'Escape'});
  assert.equal(h.tooltip.hidden, true);
  h.handlers.focusin({target:h.points[0]});
  h.handlers.focusout({target:h.points[0], relatedTarget:null});
  assert.equal(h.tooltip.hidden, true);
});
