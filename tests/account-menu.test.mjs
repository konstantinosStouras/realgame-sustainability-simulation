import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
function setup() {
  const handlers = {};
  const document = { activeElement: null, addEventListener: (type, fn) => handlers[type] = fn,
    querySelectorAll: () => menu.open ? [menu] : [] };
  const summary = { focus() { document.activeElement = this; } };
  const items = Array.from({ length: 3 }, () => ({ focus() { document.activeElement = this; } }));
  const menu = { open: false, querySelector: () => summary, querySelectorAll: () => items,
    contains: target => target === summary || items.includes(target) };
  for (const item of [summary, ...items]) item.closest = selector => selector === '.account-menu' ? menu : items.includes(item) ? item : null;
  vm.runInNewContext(source.slice(source.indexOf('// Native disclosure supports'), source.indexOf("document.addEventListener('click', async")), { document });
  const key = value => handlers.keydown({ target: document.activeElement, key: value, preventDefault() {} });
  summary.focus();
  return { handlers, document, summary, items, menu, key };
}
test('account keyboard navigation opens, wraps, and returns focus on Escape', () => {
  const h = setup();
  h.key('ArrowDown'); assert.equal(h.menu.open, true); assert.equal(h.document.activeElement, h.items[0]);
  h.key('ArrowUp'); assert.equal(h.document.activeElement, h.items[2]);
  h.key('Home'); assert.equal(h.document.activeElement, h.items[0]);
  h.key('End'); assert.equal(h.document.activeElement, h.items[2]);
  h.key('Escape'); assert.equal(h.menu.open, false); assert.equal(h.document.activeElement, h.summary);
});
test('account closes on outside focus and click, and restores trigger before actions', () => {
  const h = setup();
  h.menu.open = true; h.handlers.focusin({ target: h.items[0] }); assert.equal(h.menu.open, true);
  h.handlers.focusin({ target: {} }); assert.equal(h.menu.open, false);
  h.menu.open = true; h.handlers.click({ target: { closest: () => null } }); assert.equal(h.menu.open, false);
  h.menu.open = true; h.items[0].focus(); h.handlers.click({ target: h.items[0] });
  assert.equal(h.menu.open, false); assert.equal(h.document.activeElement, h.summary);
});
