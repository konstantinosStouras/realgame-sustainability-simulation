import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { itemName, productionRecipe } from '../src/engine.mjs';

// Unit harness for the original UI functions. It does not open a browser or
// access a real service. The coordinator separately verifies rendered behavior.
const appSource = readFileSync(new URL(process.env.UI_TEST_SOURCE || '../app.mjs', import.meta.url), 'utf8');
const definitions = appSource.replace(/^import .*;\r?\n/gm, '').split("\nawait startWorkspace();")[0];
const storage = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) }; };
function harness(hostname = 'localhost') {
  const handlers = {}, root = {}, dialog = { open: false }, toast = {};
  const document = {
    activeElement: { closest: () => null },
    querySelector: selector => ({ '#app': root, '#dialog': dialog, '#toast': toast })[selector] || null,
    addEventListener: (type, handler) => { handlers[type] = handler; }
  };
  const context = vm.createContext({
    document, localStorage: storage(), sessionStorage: storage(), crypto: { randomUUID },
    setTimeout: () => 1, clearTimeout: () => {}, URL, AbortSignal,
    FormData: class extends Map { constructor(form) { super(form.values); } },
    itemName, productionRecipe, INVESTMENTS: {}, FEATURES: [], firebaseConfig: {}, classroomBackend: 'https://classroom.example', location: { hostname, href: 'https://' + hostname + '/' }, renderCount: 0,
    activeTestForm: null
  });
  context.history = { replaceState: (_, __, href) => { context.location.href = href; } };
  vm.runInContext(definitions, context);
  const run = code => vm.runInContext(code, context);
  run(`render = () => { renderCount++; if (activeTestForm) activeTestForm.isConnected = false; };
    state = { revision: 1, hour: 72, startDate: '2026-01-01T00:00:00Z' };
    actor = { id: 'test-user', role: 'instructor' }; sessionId = 'test-session';`);
  const form = {
    id: 'message-form', isConnected: true, dataset: {}, values: [['text', 'Preserve this draft']],
    submit: { disabled: false }, error: { textContent: '' },
    querySelector(selector) { return selector === '.error' ? this.error : this.submit; }
  };
  form.error.focus = () => { document.activeElement = form.error; };
  form.error.closest = () => form;
  context.activeTestForm = form;
  return { context, run, form, toast, handlers, document };
}

test('409 refresh preserves the connected draft and exposes an accessible error', async () => {
  const h = harness();
  h.context.apiImplementation = async path => {
    if (path.endsWith('/command')) throw Object.assign(new Error('Session changed. Review and retry.'), { status: 409 });
    return { state: { revision: 2, hour: 72 }, actor: { id: 'test-user', role: 'instructor' } };
  };
  h.run('api = apiImplementation;');
  await h.handlers.submit({ target: h.form, preventDefault() {} });
  assert.equal(h.context.renderCount, 0);
  assert.equal(h.form.isConnected, true);
  assert.equal(h.form.values[0][1], 'Preserve this draft');
  assert.match(h.form.error.textContent, /Session changed/);
  assert.equal(h.document.activeElement, h.form.error);
  assert.equal(h.form.error.tabIndex, -1);
  assert.equal(h.form.submit.disabled, false);
  assert.equal(h.run('state.revision'), 2);
  assert.equal(h.run('submittingForms.size'), 0);
});

test('unknown response keeps the draft and retry reuses the original request key', async () => {
  const h = harness(), keys = [];
  let fail = true;
  h.context.apiImplementation = async (path, body) => {
    if (path.endsWith('/command')) {
      keys.push(body.key);
      if (fail) throw new Error('Connection interrupted');
      return { message: 'Message sent.' };
    }
    return { state: { revision: 2, hour: 72 }, actor: { id: 'test-user', role: 'instructor' } };
  };
  h.run('api = apiImplementation;');
  await h.handlers.submit({ target: h.form, preventDefault() {} });
  assert.equal(h.context.renderCount, 0);
  assert.equal(h.form.isConnected, true);
  assert.match(h.form.error.textContent, /Connection interrupted/);
  fail = false;
  await h.handlers.submit({ target: h.form, preventDefault() {} });
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(h.context.renderCount, 1);
});

test('a transient cloud 503 retains the decision key for a safe retry', async () => {
  const h = harness(), keys = []; let unavailable = true;
  h.context.apiImplementation = async (path, body) => {
    if (path.endsWith('/command')) { keys.push(body.key); if (unavailable) throw Object.assign(new Error('Result not confirmed. Retry safely.'), {status: 503}); return {message:'Confirmed'}; }
    return {state:{revision:2,hour:72},actor:{id:'test-user',role:'instructor'}};
  };
  h.run('api = apiImplementation;');
  await h.handlers.submit({target:h.form,preventDefault(){}});
  unavailable = false;
  await h.handlers.submit({target:h.form,preventDefault(){}});
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
});

test('removing a chart series does not change the remaining company colors', () => {
  const h = harness();
  h.run(`state.companies = [1,2,3].map(i => ({ id: 'company-'+i, name: 'Company '+i }));
    state.snapshots = [{ hour: 72, companies: state.companies.map((c,i) => ({ ...c, profit: i*100 })) }];`);
  const all = h.run("chart('profit', 'EUR', {selected: true})");
  h.run("selectedCompanies = new Set(['company-1','company-3']);");
  const some = h.run("chart('profit', 'EUR', {selected: true})");
  assert.deepEqual([...all.matchAll(/chart-line color-(\d+)/g)].map(m => m[1]), ['0','1','2']);
  assert.deepEqual([...some.matchAll(/chart-line color-(\d+)/g)].map(m => m[1]), ['0','2']);
});

test('last-series guard explains why one company stays selected', async () => {
  const h = harness();
  h.run("state.companies = [{id:'company-1'}]; selectedCompanies = new Set(['company-1']);");
  await h.handlers.change({ target: { name: 'series-company-1', checked: false } });
  assert.match(h.toast.textContent, /at least one company/);
  assert.equal(h.run("selectedCompanies.has('company-1')"), true);
});

test('dispatch with no routes gives an explanation instead of building an invalid quote', () => {
  const h = harness();
  h.run("state.company = {orders:[{id:'order-1'}]}; state.catalog = { routes:[] }; modal = (title, body) => { modalResult = {title,body}; }; openDispatch('order-1');");
  assert.match(h.run('modalResult.title'), /No transport routes/);
  assert.match(h.run('modalResult.body'), /order remains open/);
});

test('dispatch with no finished stock gives an explanation instead of a zero-quantity form', () => {
  const h = harness();
  h.run("state.company = {orders:[{id:'order-1'}],inventory:{panel:{qty:0}}}; state.catalog = { routes:[{enabled:true}] }; modal = (title, body) => { modalResult = {title,body}; }; openDispatch('order-1');");
  assert.match(h.run('modalResult.title'), /No modules available/);
  assert.match(h.run('modalResult.body'), /order remains open/);
});

test('settings that complete a session do not attempt a rejected follow-up clock command', async () => {
  const h = harness();
  h.run("state.name='Test'; state.status='paused'; state.hour=312; state.endHour=720; state.secondsPerHour=4; submitted=[]; modal=(title, body, submit)=>{ settingsSubmit=submit; }; command=async cmd=>{submitted.push(cmd); if(cmd.type==='configure')state.status='completed';};");
  await h.run("action('settings', '')");
  h.context.settingsFields = new Map([['name','Test'],['days','13'],['speed','4']]);
  await h.run('settingsSubmit(settingsFields)');
  assert.equal(h.run('submitted.length'), 1);
  assert.equal(h.run('submitted[0].type'), 'configure');
});

test('student workspace exposes nine categories and shows filtered live stock with one Inventory heading', () => {
  const h = harness();
  h.run(`actor.role = 'student'; page = 'workspace';
    state.recipe = {cell:32,frame:1,controller:2};
    state.company = {
      inventory:{cell:{qty:64,capacity:128,value:6400,carbon:32},panel:{qty:2,capacity:4,value:25000,carbon:120}},
      purchases:[{item:'cell',qty:240,receivedAt:null}]
    };
    openPanels.add('inventory');`);
  const navigation = h.run('workspaceNavigation(false, () => true)');
  assert.equal((navigation.match(/data-action="workspace-tool"/g) || []).length, 8);
  assert.match(navigation, /data-id="operations"[\s\S]*data-id="logistics"[\s\S]*href="notes\/model.md"[\s\S]*data-id="help"/);
  const workspace = h.run('studentWorkspace(() => true)');
  assert.equal((workspace.match(/<h2[^>]*>Inventory<\/h2>/g) || []).length, 1);
  assert.match(workspace, /Solar panel[\s\S]*Photo cell[\s\S]*240/);
  h.run("inventoryCategories.delete('component')");
  assert.doesNotMatch(h.run('studentWorkspace(() => true)'), /Photo cell/);
  assert.doesNotMatch(h.run("studentWorkspace(key => key !== 'supply')"), /Solar panel/);
});

test('pending energy and shift decisions retain the accepted choice and effective time', () => {
  const h = harness();
  h.run(`actor.role = 'student'; state.status = 'paused'; state.features = {energy:{allowed:true},investments:{allowed:true},production:{allowed:true}};
    state.effects = {carbonDemand:true}; state.snapshots = []; state.companies = [{id:'company-1'}];
    const provider = (id,name) => ({id,name,enabled:true,rates:[17,22,14],daily:1800,fee:0,delay:24,carbon:0.035});
    state.catalog = {energy:[provider('grid','Grid'),provider('wind','Wind'),provider('solar','Solar')]};
    state.company = {id:'company-1',energy:'grid',energyTerms:state.catalog.energy[0],investments:[],quality:1,research:0,marketing:0,shifts:[true,false,false],machines:2,workers:8,production:12,energyKwh:36,efficiency:1,lastBottleneck:'Materials'};
    state.events = [{companyId:'company-1',type:'energy',status:'pending',at:120,data:{energyId:'wind',terms:state.catalog.energy[1]}}, {companyId:'company-1',type:'shifts',status:'pending',at:80,data:{shifts:[false,true,true]}}];`);
  const energy = h.run('energyPage()'), shifts = h.run('productionPage()');
  assert.match(energy, /Switch to Wind pending/);
  assert.match(energy, /Effective 6 Jan/);
  assert.match(energy, /data-action="energy-switch" data-id="solar" disabled/);
  assert.match(energy, /Switch pending/);
  assert.match(energy, /0.035/);
  assert.match(shifts, /Active schedule:<\/strong> 00:00–08:00/);
  assert.match(shifts, /Saved schedule pending: 08:00–16:00, 16:00–24:00/);
  assert.match(shifts, /Effective 4 Jan/);
  assert.match(shifts, /name="shift1" type="checkbox" checked disabled/);
  assert.match(shifts, /Shift change pending/);
});

test('startup waits for restored authentication without showing login for either role', async () => {
  for (const role of ['student', 'instructor']) {
    const h = harness('classroom.example');
    let resolveAuth;
    h.context.restoreAuth = () => new Promise(resolve => { resolveAuth = resolve; });
    h.run(`getFirebase = restoreAuth; api = async () => ({ auth: 'firebase' });
      renderWelcome = () => { throw new Error('Login must not render'); };
      enterFirebase = async () => { renderCount++; };`);
    const started = h.run('startWorkspace()');
    await Promise.resolve(); await Promise.resolve();
    assert.equal(h.context.renderCount, 0);
    resolveAuth({ user: { role } });
    await started;
    assert.equal(h.context.renderCount, 1);
  }
});

test('confirmed signed-out startup shows login once', async () => {
  const h = harness();
  h.run(`api = async () => ({ auth: 'firebase' }); getFirebase = async () => ({ user: null });
    renderWelcome = () => { renderCount++; };`);
  await h.run('startWorkspace()');
  assert.equal(h.context.renderCount, 1);
});

test('transient startup failures preserve the existing session', async () => {
  const h = harness();
  h.run(`token = 'test-token'; sessionStorage.setItem('studio-token', token);
    api = async () => ({ auth: 'local' }); enter = async () => { throw new Error('Offline'); };
    renderWelcome = () => { renderCount++; };`);
  await h.run('startWorkspace()');
  assert.equal(h.context.renderCount, 0);
  assert.equal(h.run('token'), 'test-token');
  assert.match(h.run('root.innerHTML'), /Try again/);
});

test('late refresh responses cannot overwrite newer state or a different preview', async () => {
  const h = harness(), requests = [];
  h.context.respond = () => new Promise(resolve => requests.push(resolve));
  h.run('api = respond;');
  const old = h.run('load(false)'), latest = h.run('load(false)');
  requests[1]({ state: { revision: 3 }, actor: { role: 'instructor' } }); await latest;
  requests[0]({ state: { revision: 2 }, actor: { role: 'instructor' } }); await old;
  assert.equal(h.run('state.revision'), 3);
  const previousPreview = h.run('load(false)');
  h.run("preview = 'another-company';");
  requests[2]({ state: { revision: 4 }, actor: { role: 'student' } }); await previousPreview;
  assert.equal(h.run('state.revision'), 3);
  assert.equal(h.run('pendingLoads'), 0);
});

for (const mode of ['inline', 'modal']) for (const choice of ['oslo', 'custom']) {
  test(mode + ' creation preserves every draft field after duplicate ' + choice + ' ID and retries', async () => {
    const h = harness();
    h.form.id = mode === 'modal' ? 'modal-form' : 'create-session-form';
    h.form.values = [['name', 'Preserve class draft'], ['sessionCity', choice], ['customSessionId', 'QA-Custom-731'], ['days', '17'], ['companies', 'Draft Solar\nDraft Energy'], ['seed', '73'], ['revenueAt', 'dispatch'], ['corporateOverhead', '12.34']];
    const original = structuredClone(h.form.values), requests = [];
    let duplicate = true;
    h.context.apiImplementation = async (path, body) => {
      assert.equal(path, '/sessions'); requests.push(body);
      if (duplicate) throw Object.assign(new Error('Session ID is already taken. Choose another city or a custom ID.'), { status: 409 });
      return { id: body.id.toLowerCase() };
    };
    h.run('health = { classroomAccounting: true }; api = apiImplementation; enter = async () => {};');
    let submit;
    const dialog = h.document.querySelector('#dialog');
    if (mode === 'modal') {
      dialog.querySelectorAll = () => [];
      dialog.querySelector = () => h.form;
      dialog.showModal = () => { dialog.open = true; };
      dialog.close = () => { dialog.open = false; };
      h.run("modal('Create a classroom session', createSessionFields(), createClassroom, 'Create session')");
      submit = () => h.form.onsubmit({ preventDefault() {} });
    } else submit = () => h.handlers.submit({ target: h.form, preventDefault() {} });
    await submit();
    assert.deepEqual(h.form.values, original);
    assert.equal(h.form.isConnected, true);
    assert.equal(h.context.renderCount, 0);
    assert.equal(h.form.submit.disabled, false);
    assert.match(h.form.error.textContent, /already taken.*another city or a custom ID/);
    assert.equal(h.document.activeElement, h.form.error);
    if (mode === 'modal') assert.equal(dialog.open, true);
    assert.equal(requests[0].id, choice === 'custom' ? 'QA-Custom-731' : 'oslo');
    assert.equal(requests[0].dailyCorporateOverhead, 1234);
    duplicate = false;
    h.form.values.find(([key]) => key === 'sessionCity')[1] = 'custom';
    h.form.values.find(([key]) => key === 'customSessionId')[1] = 'fresh-class-731';
    await submit();
    assert.equal(requests[1].id, 'fresh-class-731');
    for (const key of ['name', 'seed', 'days', 'revenueAt', 'dailyCorporateOverhead']) assert.equal(requests[1][key], requests[0][key]);
    assert.deepEqual(requests[1].companyNames, requests[0].companyNames);
    assert.equal(h.run("new URL(location.href).searchParams.get('session')"), 'fresh-class-731');
    if (mode === 'modal') assert.equal(dialog.open, false);
  });
}
