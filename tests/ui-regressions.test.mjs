import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { applyCommand, createSession, itemName, productionRecipe } from '../src/engine.mjs';

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
    applyCommand, createSession, itemName, productionRecipe, INVESTMENTS: {}, FEATURES: [], firebaseConfig: {}, classroomBackend: 'https://classroom.example', location: { hostname, href: 'https://' + hostname + '/' }, renderCount: 0,
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
  h.run("state=createSession({name:'Test'}); health={atomicSessionSettings:true}; state.status='paused'; state.hour=312; state.endHour=720; state.secondsPerHour=4; submitted=[]; modal=(title, body, submit)=>{ settingsSubmit=submit; }; command=async cmd=>{submitted.push(cmd); applyCommand(state, actor, cmd);};");
  await h.run("action('settings', '')");
  h.context.settingsFields = new Map([['name','Test'],['days','13'],['speed','4']]);
  await h.run('settingsSubmit(settingsFields)');
  assert.equal(h.run('submitted.length'), 1);
  assert.equal(h.run('submitted[0].type'), 'configure');
  assert.equal(h.run('submitted[0].secondsPerHour'), 4);
  assert.equal(h.run('state.endHour'), 312);
  assert.equal(h.run('state.status'), 'completed');
});

test('truck badge counts each order with units left to dispatch', () => {
  const h = harness();
  h.run('state.company = { orders: [{ remaining: 10 }, { remaining: 2 }, { remaining: 0 }] }');
  const navigation = h.run('workspaceNavigation(false, () => true)');
  assert.match(navigation, /class="dispatch-count" aria-hidden="true">2<\/span>/);
  assert.match(navigation, /2 orders waiting to be dispatched/);
  assert.doesNotMatch(h.run("workspaceNavigation(false, key => key !== 'orders')"), /dispatch-count/);
  h.run('state.company.orders.forEach(order => { order.remaining = 0; })');
  assert.doesNotMatch(h.run('workspaceNavigation(false, () => true)'), /dispatch-count/);
});

test('sidebar selects only the current panel and gives orders a single category owner', () => {
  const h = harness();
  h.run("actor.role='student';page='workspace';state.company={orders:[]};['offers','production','finance','messages','inventory'].forEach(id=>openPanels.add(id));selectedPanel='offers';");
  let html = h.run('workspaceNavigation(false, () => true)');
  assert.equal((html.match(/class="active"/g)||[]).length,1);
  assert.match(html, /data-id="sales"[^>]*aria-current="true"[^>]*class="active"/);
  assert.doesNotMatch(html, /data-id="(?:inbox|chat)"/);
  h.run("selectedPanel='orders';openPanels.add('orders');");
  assert.equal(h.run('selectedWorkspaceTool(false, () => true)'), 'sales');
  h.run("openPanels.delete('orders');selectedPanel='messages';");
  assert.equal(h.run('selectedWorkspaceTool(false, () => true)'), 'messages');
  h.run("openPanels.delete('messages');");
  assert.equal(h.run('selectedWorkspaceTool(false, () => true)'), 'logistics');
  h.run("page='reports';");
  html=h.run('workspaceNavigation(false, () => true)');
  assert.equal((html.match(/class="active"/g)||[]).length,1);
  assert.match(html,/data-id="reports"[^>]*aria-current="page"/);
  h.run("page='workspace';selectedPanel='finance';");
  assert.equal(h.run("selectedWorkspaceTool(false, key => key !== 'finance')"),'logistics');
});

test('unified messages show all authorized conversations and label recipients separately', () => {
  const h=harness();h.run(`actor={id:'s',role:'student',companyId:'c1'};state.status='paused';state.features={messaging:{allowed:true}};state.companies=[{id:'c1',name:'One'},{id:'c2',name:'Two'}];channel='all';
    state.messages=[['announcements','Class notice'],['team:c1','Team discussion'],['teacher:c1','Instructor reply'],['team:c2','Private other team']].map(([channel,text],i)=>({channel,text,senderName:'Sender',role:'student',hour:24,realAt:'2026-01-02T00:00:00.123Z'}));`);
  const html=h.run('messagesPage()');
  for(const text of ['Class notice','Team discussion','Instructor reply','All messages','Send to'])assert.ok(html.includes(text));
  assert.doesNotMatch(html,/Private other team/);
  const recipient=html.match(/<select name="recipient">([\s\S]*?)<\/select>/)[1];
  assert.match(recipient,/team:c1/);assert.match(recipient,/teacher:c1/);assert.doesNotMatch(recipient,/announcements|team:c2|value="all"/);
  h.run("channel='announcements'");
  assert.doesNotMatch(h.run('messagesPage()'),/<p>Team discussion<\/p>/);
  h.run("actor.role='instructor';channel='all'");
  const teacher=h.run('messagesPage()');
  assert.match(teacher,/value="announcements" selected/);assert.match(teacher,/value="teacher:c2"/);
  assert.doesNotMatch(teacher,/<p>Team discussion<\/p>|Private other team/);
});

test('message submission uses the selected recipient rather than the all-messages filter', async () => {
  const h=harness();h.form.values.push(['recipient','teacher:c1']);h.run("channel='all';command=async c=>{globalThis.sent=c;}");
  await h.handlers.submit({target:h.form,preventDefault(){}});
  assert.equal(h.context.sent.channel,'teacher:c1');assert.equal(h.context.sent.text,'Preserve this draft');
});

test('message headers retain full names without repeating roles or internal labels', () => {
  const h=harness();
  h.run(`actor={id:'s',role:'student',companyId:'c1'};state.status='paused';state.features={messaging:{allowed:true}};state.companies=[];channel='all';
    state.messages=[{channel:'announcements',senderId:'t',senderName:'Taylor Morgan',role:'instructor',text:'Review your plan.'},{channel:'team:c1',senderId:'s',senderName:'Alex Parker',role:'student',text:'Ready.'}].map(m=>({...m,hour:24,realAt:'2026-11-15T10:00:00Z'}));`);
  const html=h.run('messagesPage()');
  const headers=[...html.matchAll(/<div class="message-header">(.*?)<\/div>/g)].map(m=>m[1]);
  assert.equal(headers[0],'<span>Instructor announcement</span><span>Taylor Morgan</span>');
  assert.equal(headers[1],'<span>Alex Parker</span>');
  assert.doesNotMatch(html,/internal|· student|· instructor/);
});

test('typing sends only a flag, clears on blur and ignores results after leaving a team view', async () => {
  const h=harness(), calls=[], notice={innerHTML:'',dataset:{}}, textarea={value:'Private draft'}, recipient={value:'team:c1'};
  const nodes={'[data-team-typing]':notice,'#message-form textarea':textarea,'#message-form [name=recipient]':recipient};
  h.context.document.querySelector('#app').querySelector=selector=>nodes[selector];
  h.context.document.activeElement=textarea;
  h.context.fetch=async (url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({typing:true})};};
  h.run("actor={id:'s',role:'student',companyId:'c1'};state.status='paused';state.features={messaging:{allowed:true,visible:true}};health={typingPresence:true};channel='all';typingInputAt=Date.now();");
  await h.run('syncTyping(true)');
  assert.deepEqual(JSON.parse(calls[0].options.body),{active:true});
  assert.match(notice.innerHTML,/typing-bubble/);
  assert.match(notice.innerHTML,/A teammate is typing/);
  await h.run('syncTyping(true)');assert.equal(calls.length,1,'input is throttled');
  h.context.document.activeElement=null;
  await h.run('syncTyping(true)');assert.deepEqual(JSON.parse(calls[1].options.body),{active:false});
  let resolve;
  h.context.fetch=()=>new Promise(r=>{resolve=r;});
  const pending=h.run('syncTyping()');
  delete nodes['[data-team-typing]'];notice.innerHTML='';
  resolve({ok:true,json:async()=>({typing:true})});await pending;
  assert.equal(notice.innerHTML,'','late response cannot restore a typing indicator after navigation');
});

test('decision timing separates students, excludes non-decisions and preserves millisecond timestamps', () => {
  const h=harness();h.context.audit=[0,500,1000,1500].map((ms,i)=>({id:'a'+i,role:'student',actorId:'s1',actorName:'Student',companyId:'c1',realAt:new Date(Date.UTC(2026,0,1)+ms).toISOString(),hour:0,command:{type:'offer'},result:'Saved'}));
  h.context.audit.push({role:'student',actorId:'s2',realAt:'2026-01-01T00:00:00.250Z',command:{type:'purchase'}},{role:'student',actorId:'s1',realAt:'bad',command:{type:'staff'}},{role:'student',actorId:'s1',realAt:'2026-01-01T00:00:00.100Z',command:{type:'message'}},{role:'instructor',actorId:'teacher',realAt:'2026-01-01T00:00:00.000Z',command:{type:'offer'}});
  const before=JSON.stringify(h.context.audit),rows=h.run('decisionTiming(audit)');
  assert.equal(rows.length,2);assert.equal(rows[0].review,true);assert.equal(rows[0].peak2,4);assert.equal(rows[0].minimumGap,500);assert.equal(rows[0].rapidPairs,3);assert.equal(rows[0].missing,1);
  assert.equal(rows[1].review,false);assert.equal(rows[1].minimumGap,null);assert.equal(JSON.stringify(h.context.audit),before);
  h.context.player=rows[0];assert.equal(h.run('decisionTimingRows(player)[1][0]'),'2026-01-01T00:00:00.500Z');
});

test('timing thresholds require a burst, handle boundary cases, and remain instructor-only', () => {
  const h=harness();const audit=times=>times.map(ms=>({role:'student',actorId:'s',actorName:'Student',companyId:'c1',realAt:new Date(ms).toISOString(),hour:0,command:{type:'dispatch'}}));
  for(const [times,expected] of [[[0,500],false],[[0,700,1400,2000],true],[[0,700,1400,2001],false],[[0,2000,4000,6000,8000,10000],true],[[0,2000,4000,6000,8000,10001],false]]){h.context.audit=audit(times);assert.equal(h.run('decisionTiming(audit)[0].review'),expected);}
  h.context.audit=audit([0,100,200,300]);h.run("state.audit=audit;state.companies=[{id:'c1',name:'One'}]");
  assert.match(h.run('decisionTimingPanel()'),/review signal, not proof of AI use/);
  h.run("actor.role='student'");assert.equal(h.run('decisionTimingPanel()'),'');
});

test('student workspace exposes seven categories and shows filtered live stock with one Inventory heading', () => {
  const h = harness();
  h.run(`actor.role = 'student'; page = 'workspace';
    state.recipe = {cell:32,frame:1,controller:2};
    state.company = {
      inventory:{
        cell:{qty:64,capacity:128,value:6400,carbon:32},
        frame:{qty:6,capacity:12,value:600,carbon:6},
        controller:{qty:8,capacity:16,value:800,carbon:8},
        panel:{qty:2,capacity:4,value:25000,carbon:120}
      },
      purchases:[
        {id:'later',item:'cell',qty:224,expectedAt:75,receivedAt:null},
        {id:'first',item:'cell',qty:16,expectedAt:73,receivedAt:null},
        {id:'received',item:'controller',qty:100,expectedAt:70,receivedAt:70}
      ]
    };
    openPanels.add('inventory');`);
  const navigation = h.run('workspaceNavigation(false, () => true)');
  assert.equal((navigation.match(/data-action="workspace-tool"/g) || []).length, 7);
  assert.match(navigation, /data-id="operations"[\s\S]*data-id="logistics"[\s\S]*data-id="help"/);
  const workspace = h.run('studentWorkspace(() => true)');
  assert.equal((workspace.match(/<h2[^>]*>Inventory<\/h2>/g) || []).length, 1);
  assert.match(workspace, /Solar panel[\s\S]*Photo cell[\s\S]*240/);
  assert.match(workspace, /Needed \/ solar panel/);
  assert.match(workspace, /Solar panel<\/td><td[^>]*>[^]*?\/ 4<\/span><\/td><td[^>]*>—<\/td>/);
  assert.match(workspace, /2 solar panels from stock on hand/);
  assert.match(workspace, /After incoming orders: 4 solar panels \(2 more\)/);
  assert.match(workspace, /Limiting after receipt: Junction box<\/span>/);
  assert.match(workspace, /data-sort-label="Total buildable"[^]*data-sort-label="Limiting components"/);
  assert.match(workspace, /first<small><\/small><\/td><td[^>]*>16 × Photo cell<\/td><td[^>]*>4 Jan, 01:00<\/td><td[^>]*>0<\/td><td[^>]*>2<\/td><td[^>]*>Photo cell<\/td>.*later<small><\/small><\/td><td[^>]*>224 × Photo cell<\/td><td[^>]*>4 Jan, 03:00<\/td><td[^>]*>\+2<\/td><td[^>]*>4<\/td><td[^>]*>Junction box<\/td>/);
  assert.doesNotMatch(workspace, /received<small>/);
  assert.match(workspace, /Limiting: Photo cell<\/span>/);
  assert.match(workspace, /Photo cell<\/td><td[^>]*>[^]*?\/ 128<\/span><\/td><td[^>]*><span class="quantity-status"><span>32<\/span><span class="badge amber">Limiting<\/span><\/span><\/td>/);
  assert.match(workspace, /Recycled frame<\/td><td[^>]*>[^]*?\/ 12<\/span><\/td><td[^>]*><span class="quantity-status"><span>1<\/span><\/span><\/td>/);
  assert.match(workspace, /Junction box<\/td><td[^>]*>[^]*?\/ 16<\/span><\/td><td[^>]*><span class="quantity-status"><span>2<\/span><\/span><\/td>/);
  h.run('delete state.recipe');
  const legacy = h.run('studentWorkspace(() => true)');
  assert.match(legacy, /Needed \/ solar module/);
  assert.match(legacy, /2 solar modules from stock on hand/);
  assert.match(legacy, /After incoming orders: 6 solar modules \(4 more\)/);
  assert.match(legacy, /Limiting after receipt: Recycled frame<\/span>/);
  assert.match(legacy, /16 × PV cell<\/td><td[^>]*>4 Jan, 01:00<\/td><td[^>]*>\+1<\/td><td[^>]*>3<\/td><td[^>]*>PV cell<\/td>/);
  assert.match(legacy, /224 × PV cell<\/td><td[^>]*>4 Jan, 03:00<\/td><td[^>]*>\+3<\/td><td[^>]*>6<\/td><td[^>]*>Recycled frame<\/td>/);
  assert.match(legacy, /PV cell<\/td><td[^>]*>[^]*?\/ 128<\/span><\/td><td[^>]*><span class="quantity-status"><span>24<\/span><span class="badge amber">Limiting<\/span><\/span><\/td>/);
  assert.match(legacy, /Controller<\/td><td[^>]*>[^]*?\/ 16<\/span><\/td><td[^>]*><span class="quantity-status"><span>1<\/span><\/span><\/td>/);
  h.run('state.recipe = {cell:32,frame:1,controller:2}');
  h.run('state.company.inventory.controller.qty = 4');
  const tied = h.run('studentWorkspace(() => true)');
  assert.match(tied, /Limiting: Photo cell, Junction box<\/span>/);
  assert.match(tied, /After incoming orders: 2 solar panels \(0 more\)/);
  assert.match(tied, /16 × Photo cell<\/td><td[^>]*>4 Jan, 01:00<\/td><td[^>]*>0<\/td><td[^>]*>2<\/td><td[^>]*>Photo cell, Junction box<\/td>/);
  h.run('state.company.inventory.cell.qty = 0');
  assert.match(h.run('studentWorkspace(() => true)'), /0 solar panels from stock on hand/);
  h.run("inventoryCategories.delete('component')");
  const finishedOnly = h.run('studentWorkspace(() => true)');
  assert.doesNotMatch(finishedOnly, /aria-label="Component"/);
  assert.match(finishedOnly, /224 × Photo cell<\/td>/);
  assert.match(finishedOnly, /Limiting: Photo cell<\/span>/);
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

test('revoked temporary access removes decisions and reconnects when access reopens', async () => {
  const h = harness(), dialog = h.document.querySelector('#dialog');
  dialog.open = true; dialog.close = () => { dialog.open = false; };
  let denied = true;
  h.context.apiImplementation = async () => {
    if (denied) throw Object.assign(new Error('Session closed'), {status:403});
    return {state:{revision:3,hour:72},actor:{id:'student',role:'student'}};
  };
  h.run("testRoom = {}; user = {id:'student',role:'student'}; api = apiImplementation;");
  await h.run('load(false)');
  assert.equal(h.run('state'), null);
  assert.equal(h.run('actor'), null);
  assert.equal(dialog.open, false);
  assert.equal(h.run('sessionId'), 'test-session');
  assert.equal(h.run('testAccessClosed'), true);
  assert.match(h.document.querySelector('#app').innerHTML, /Test classroom access is closed/);
  assert.match(h.document.querySelector('#app').innerHTML, /test-retry/);
  denied = false;
  await h.run('load(false)');
  assert.equal(h.run('testAccessClosed'), false);
  assert.equal(h.run('state.revision'), 3);
  assert.equal(h.run('actor.id'), 'student');
  assert.equal(h.context.renderCount, 1);
});

test('temporary decision access rejection refreshes and removes stale controls', async () => {
  const h = harness();
  h.context.deniedCall = async () => { throw Object.assign(new Error('Access closed'), {status:403}); };
  h.run('testRoom = {call:deniedCall};');
  await assert.rejects(h.run("command({type:'budget',research:0,marketing:0})"), {status:403});
  assert.equal(h.run('state'), null);
  assert.equal(h.run('testAccessClosed'), true);
  assert.equal(h.run('testPending'), null);
});

test('temporary throttling keeps the original request key for an exact retry', async () => {
  const h = harness(), requests = []; let throttled = true;
  h.context.callImplementation = async (action, payload) => {
    if (action === 'command') {
      requests.push(payload.key);
      if (throttled) throw Object.assign(new Error('Try again'), {status:429});
      return {message:'Accepted'};
    }
    return {state:{revision:2,hour:72},actor:{id:'test-user',role:'instructor'}};
  };
  h.run('testRoom = {call:callImplementation};');
  await assert.rejects(h.run("command({type:'step',hours:1})"), {status:429});
  throttled = false;
  await h.run("command({type:'step',hours:1})");
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
});

test('twelve competing companies have distinct stable chart and legend colors', () => {
  const h = harness();
  h.run(`state.companies = Array.from({length:12},(_,i)=>({id:'company-'+(i+1),name:'Team '+(i+1)}));
    state.snapshots = [{hour:72,companies:state.companies.map((c,i)=>({...c,profit:i*100}))}];`);
  const all = h.run("chart('profit','EUR',{selected:true})");
  const colors = [...all.matchAll(/chart-line color-(\d+)/g)].map(m=>m[1]);
  assert.equal(new Set(colors).size, 12);
  assert.deepEqual([...all.matchAll(/legend-dot c(\d+)/g)].map(m=>m[1]), colors);
  h.run("selectedCompanies = new Set(['company-4','company-12']);");
  assert.deepEqual([...h.run("chart('profit','EUR',{selected:true})").matchAll(/chart-line color-(\d+)/g)].map(m=>m[1]), ['3','11']);
  const css = readFileSync(new URL('../styles.css',import.meta.url),'utf8');
  const dark = readFileSync(new URL('../theme.css',import.meta.url),'utf8');
  for(let i=0;i<12;i++) {
    assert.ok(css.includes(`.color-${i}{stroke:var(--chart-${i})}`));
    assert.ok(css.includes(`.chart circle.c${i}{fill:var(--chart-${i})}`));
    assert.match(dark, new RegExp(`--chart-${i}:#[a-f0-9]{6}`));
  }
});


test('help uses current recipe and accounting and keeps guidance inside the app', () => {
  const h=harness();
  h.run("actor.role='student';state.recipe={cell:32,frame:1,controller:2};state.accounting={revenueAt:'dispatch'};");
  const help=h.run('helpPage()');
  assert.match(help,/32 × Photo cell/);
  assert.match(help,/recognizes sales at dispatch/);
  assert.match(help,/Team responsibilities and planning/);
  assert.match(help,/real data collected from several suppliers/);
  assert.match(help,/data-action="nav" data-id="orders"/);
  assert.doesNotMatch(help,/independently authored|notes\/model\.md|Instructor controls and decision timing/);
  h.run("actor.role='instructor';state.accounting.revenueAt='receipt'");
  assert.match(h.run('helpPage()'),/recognizes sales at customer receipt/);
  assert.match(h.run('helpPage()'),/Instructor controls and decision timing/);
});

test('instructor timing CSV exports each accepted decision and protects student access', async () => {
  const h=harness();
  h.run("state.companies=[{id:'c1',name:'One'}];state.audit=[{role:'student',actorId:'s1',actorName:'Student',companyId:'c1',realAt:'2026-01-01T00:00:00.125Z',hour:2,command:{type:'offer'},result:'Saved'}];");
  h.context.exports=[];h.run('csv=(name,rows)=>exports.push({name,rows})');
  await h.run("action('decision-timing-csv','')");
  assert.equal(h.context.exports.length,1);
  const output=h.context.exports[0];
  assert.equal(output.rows.length,2);
  assert.equal(output.rows[1][0],'s1');
  assert.equal(output.rows[1][3],'2026-01-01T00:00:00.125Z');
  assert.equal(output.rows[1][5],'offer');
  assert.equal(output.rows[1][7],'Saved');
  h.run("actor.role='student'");
  await h.run("action('decision-timing-csv','')");
  assert.equal(h.context.exports.length,1);
});
