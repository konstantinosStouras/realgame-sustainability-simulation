import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as engine from '../src/engine.mjs';

const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').split('\nawait startWorkspace();')[0];
const storage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };

// A small DOM fixture models replacement, parent identities, focus and scrolling.
// It deliberately does not emulate layout or claim rendered-browser coverage.
function harness() {
  let html = '', nodes = [];
  const handlers = {};
  const body = { closest: () => null }, document = { activeElement: body, scrollingElement: { scrollLeft: 0, scrollTop: 0 }, addEventListener: (name, handler) => { handlers[name] = handler; } };
  const model = { orders: ['first', 'second'], day: 24, value: 'fresh' };
  const root = { querySelectorAll: () => nodes, querySelector: () => ({ insertAdjacentHTML: (_, text) => { html += text; } }) };
  const dialog = { open: false }, toast = {};
  document.querySelector = selector => ({ '#app': root, '#dialog': dialog, '#toast': toast })[selector];
  function element(tag, attrs = {}, parent = root) {
    const node = { tagName: tag.toUpperCase(), parentElement: parent, open: false, disabled: false, scrollLeft: 0, scrollTop: 0, value: model.value,
      getAttribute: key => Object.hasOwn(attrs, key) ? attrs[key] : null,
      hasAttribute: key => Object.hasOwn(attrs, key), closest(selector) {
        for (let item = this; item && item !== root; item = item.parentElement) if (selector === 'form' && item.tagName === 'FORM') return item;
        return null;
      },
      focus(options) { document.activeElement = this; this.focusOptions = options; } };
    if (Object.keys(attrs).some(key => ['data-view-key', 'id', 'name', 'data-action'].includes(key)) || tag === 'summary') nodes.push(node);
    return node;
  }
  const ui = {};
  Object.defineProperty(root, 'innerHTML', { get: () => html, set(value) {
    html = value; nodes = []; document.activeElement = body; document.scrollingElement.scrollTop = 0;
    root.firstElementChild = element('div');
    const content = element('main', { id: 'content' }, root.firstElementChild);
    ui.pane = element('div', { 'data-view-key': 'pane-finance' }, content);
    ui.details = element('details', { 'data-view-key': 'ledger-entries' }, ui.pane);
    ui.summary = element('summary', {}, ui.details);
    ui.table = element('div', { 'data-view-key': 'table:journal' }, ui.details);
    ui.chart = element('div', { 'data-view-key': 'chart:profit' }, content);
    ui.point = element('circle', { 'data-view-key': `point:company:${model.day}` }, ui.chart);
    ui.control = element('select', { name: 'report' }, content);
    ui.form = element('form', { id: 'shifts-form' }, content);
    Object.assign(ui.form, { id: 'shifts-form', dataset: {}, values: [['shift0', 'on'], ['shift1', 'on']], querySelector: () => ui.submit });
    ui.shift = element('input', { name: 'shift1' }, ui.form);
    ui.submit = element('button', { 'data-action': 'submit' }, ui.form);
    ui.orders = model.orders.map(id => element('button', { 'data-action': 'dispatch', 'data-id': id }, element('tr', {}, ui.table)));
  } });
  const context = vm.createContext({ ...engine, document, localStorage: storage(), sessionStorage: storage(),
    location: { hostname: 'localhost' }, firebaseConfig: {}, classroomBackend: '', URL, AbortSignal,
    crypto: { randomUUID: () => 'unique-request' }, FormData: class extends Map { constructor(form) { super(form.values); } }, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  const session = engine.createSession(), actor = { id: 'reader', role: 'student', name: 'Reader', companyId: session.companies[0].id };
  engine.applyCommand(session, { id: 'teacher', role: 'instructor' }, { type: 'step', hours: 24 });
  context.currentState = engine.publicView(session, actor); context.currentActor = actor;
  run("state = currentState; actor = currentActor; user = actor; sessionId = state.id; page = 'reports'; ensureSessionUpdates = () => {}; render();");
  return { run, context, root, ui, model, document, body, session, actor, dialog, handlers };
}

test('a changed live view preserves disclosure, keyboard focus and document/table/pane/chart scroll without restoring data', async () => {
  const h = harness();
  h.ui.details.open = true; h.ui.summary.focus();
  h.ui.table.scrollLeft = 280; h.ui.pane.scrollTop = 190; h.ui.chart.scrollLeft = 75;
  h.document.scrollingElement.scrollTop = 640;
  engine.applyCommand(h.session, { id: 'teacher', role: 'instructor' }, { type: 'step', hours: 1 });
  h.context.reply = { state: engine.publicView(h.session, h.actor), actor: h.actor };
  h.run('api = async () => reply;');
  await h.run('load(false)');
  assert.equal(h.run('state.hour'), 25);
  assert.equal(h.ui.details.open, true);
  assert.equal(h.document.activeElement, h.ui.summary);
  assert.equal(h.ui.summary.focusOptions.preventScroll, true);
  assert.equal(h.ui.table.scrollLeft, 280); assert.equal(h.ui.pane.scrollTop, 190); assert.equal(h.ui.chart.scrollLeft, 75);
  assert.equal(h.document.scrollingElement.scrollTop, 640);
  assert.match(h.root.innerHTML, /data-view-key="report-values"/);
  h.run("page = 'finance'; render();");
  assert.match(h.root.innerHTML, /data-view-key="ledger-entries"/);
});

test('focus follows a stable order identity across row insertion, never its former row index', () => {
  const h = harness(); h.ui.orders[1].focus();
  h.model.orders = ['new', 'second', 'first']; h.run('render()');
  assert.equal(h.document.activeElement.getAttribute('data-id'), 'second');
  h.model.orders = ['new', 'first']; h.run('render()');
  assert.equal(h.document.activeElement, h.body);
  h.ui.orders[0].focus(); h.model.orders = ['new', 'new']; h.run('render()');
  assert.equal(h.document.activeElement, h.body, 'ambiguous controls are not restored');
});

test('chart focus uses company/hour and does not jump to the next point when a range drops the focused day', () => {
  const h = harness(); h.ui.point.focus(); h.run('render()');
  assert.equal(h.document.activeElement, h.ui.point);
  h.model.day = 48; h.run('render()');
  assert.equal(h.document.activeElement, h.body);
  assert.match(h.root.innerHTML, /data-view-key="point:[^"]+:24"/);
});

test('interaction restoration never copies draft values and respects fresh disabled controls', () => {
  const h = harness(); h.ui.control.value = 'unsaved'; h.ui.control.focus();
  h.model.value = 'server-fresh'; h.run('render()');
  assert.equal(h.document.activeElement, h.ui.control);
  assert.equal(h.ui.control.value, 'server-fresh');
  h.run('globalThis.savedInteraction = captureInteraction(interactionScope());');
  h.root.innerHTML = ''; h.ui.control.disabled = true;
  h.run('restoreInteraction(savedInteraction, interactionScope());');
  assert.equal(h.document.activeElement, h.body);
});

test('interaction state cannot cross account, session, company, page or selected-view boundaries', () => {
  for (const change of ["actor = {...actor, id:'other'}", "actor = {...actor, role:'instructor'}", "actor = {...actor, companyId:'other'}",
    "sessionId = 'other'", "backend = 'https://other.invalid'", "preview = state.companies[1].id", "state.company = {...state.company,id:'other'}",
    "page = 'finance'", "channel = 'other'", "report = 'cash'", 'reportRange = 7', "openPanels.add('finance')", "selectedCompanies.add(state.companies[0].id)"]) {
    const h = harness(); h.ui.details.open = true; h.ui.summary.focus(); h.ui.table.scrollLeft = 125;
    h.run(change + '; render();');
    assert.equal(h.ui.details.open, false, change); assert.equal(h.document.activeElement, h.body, change); assert.equal(h.ui.table.scrollLeft, 0, change);
  }
  const h = harness(); h.ui.details.open = true; h.root.innerHTML = 'A different screen'; h.run('render()');
  assert.equal(h.ui.details.open, false, 'a replaced root cannot reuse an older screen snapshot');
});

test('background refresh waits out a button command; afterCommand updates fresh state and no interruption banner appears', async () => {
  const h = harness(); let resolveCommand, calls = 0;
  h.context.handleRequest = async path => {
    calls++;
    if (path.endsWith('/command')) return new Promise(resolve => { resolveCommand = resolve; });
    return { state: { ...h.context.currentState, revision: 99 }, actor: h.actor };
  };
  h.run('api = handleRequest;');
  const pending = h.run("command({type:'shifts', shifts:2})");
  assert.equal(h.run('busy'), true);
  const original = h.root.firstElementChild;
  await h.run('load(false)');
  assert.equal(calls, 1); assert.equal(h.root.firstElementChild, original);
  h.run('render()');
  assert.doesNotMatch(h.root.innerHTML, /The response was interrupted/);
  resolveCommand({ message: 'Saved' }); await pending;
  assert.equal(h.run('state.revision'), 99); assert.equal(h.run('busy'), false);
  assert.doesNotMatch(h.root.innerHTML, /The response was interrupted/);
});

test('a background read already in flight cannot replace controls after a command starts', async () => {
  const h = harness(); let reply;
  h.context.fetchView = () => new Promise(resolve => { reply = resolve; });
  h.run('api = fetchView;');
  const load = h.run('load(false)'), original = h.root.firstElementChild;
  h.run('busy = true;');
  reply({ state: { ...h.context.currentState, revision: 99 }, actor: h.actor }); await load;
  assert.equal(h.root.firstElementChild, original); assert.notEqual(h.run('state.revision'), 99); assert.equal(h.run('refreshDeferred'), true);
});

test('a genuinely interrupted command retains its retry notice after busy is cleared', async () => {
  const h = harness(); h.run("api = async () => { throw new Error('Connection lost'); };");
  await assert.rejects(h.run("command({type:'shifts', shifts:2})"), /Connection lost/);
  assert.equal(h.run('busy'), false);
  assert.match(h.root.innerHTML, /The response was interrupted/);
});

test('successful inline shifts submission releases form focus so subsequent external updates still render', async () => {
  for (const control of ['shift', 'submit']) {
    const h = harness(); h.run("page = 'production'; render();");
    h.context.handleRequest = async (path, request) => {
      if (path.endsWith('/command')) { engine.applyCommand(h.session, h.actor, request.command); return { message: 'Shifts saved' }; }
      return { state: engine.publicView(h.session, h.actor), actor: h.actor };
    };
    h.run('api = handleRequest;');
    h.ui[control].focus();
    const form = h.ui.form;
    await h.handlers.submit({ target: form, preventDefault() {} });
    assert.notEqual(h.ui.form, form, 'successful submission rebuilt the view');
    assert.equal(h.document.activeElement.closest('form'), null, control);
    assert.equal(h.run('submittingForms.size'), 0);
    const afterSubmit = h.root.firstElementChild;
    engine.applyCommand(h.session, { id: 'teacher', role: 'instructor' }, { type: 'step', hours: 1 });
    await h.run('load(false)');
    assert.equal(h.run('state.hour'), 25, control);
    assert.notEqual(h.root.firstElementChild, afterSubmit, 'external update rendered without waiting for a manual blur');
    assert.equal(h.run('refreshDeferred'), false);
  }
});
