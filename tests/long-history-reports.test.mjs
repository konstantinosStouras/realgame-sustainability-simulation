import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as engine from '../src/engine.mjs';

const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').split('\nawait startWorkspace();')[0];
function harness() {
  const session = engine.createSession({days:60,companyNames:Array.from({length:12},(_,i)=>`Team ${i + 1}`)});
  session.hour = 1440; session.status = 'completed';
  session.snapshots = Array.from({length:60}, (_,index) => ({hour:(index + 1) * 24,companies:session.companies.map((c,i) => ({
    id:c.id,name:c.name,revenue:(index + 1) * (10001 + i),production:(index + 1) * (7 + i),
    profit:-(index + 1) * (101 + i),cash:18000000-(index + 1)*101,inventory:180,
    emissions:(index + 1)*0.035,energyCost:(index + 1)*135,energyKwh:(index + 1)*10.5,
    received:(index + 1)*3,dispatched:(index + 1)*4,marketShare:100/12
  }))}));
  const teacher = {id:'instructor',role:'instructor',name:'Test instructor'};
  const storage = {getItem:()=>null,setItem(){},removeItem(){}};
  const context = vm.createContext({...engine,URL,AbortSignal,setTimeout,clearTimeout,localStorage:storage,sessionStorage:storage,
    classroomBackend:'',firebaseConfig:{},location:{hostname:'localhost'},document:{querySelector:()=>({open:false}),addEventListener(){}},
    view:engine.publicView(session,teacher,'company-1'),testActor:teacher,captured:[]});
  vm.runInContext(source,context);
  const run = code=>vm.runInContext(code,context);
  run("state=view; actor=testActor; user=testActor; sessionId=state.id; preview='company-1'; download=(name,data,type)=>captured.push({name,data,type});");
  return {run,context};
}

test('60-day reports show exactly the selected completed-day window in chart, table and CSV', async () => {
  const h = harness();
  for (const [range,count] of [[7,7],[30,30],[180,60]]) {
    h.run(`reportRange=${range}; report='dailySales'; selectedCompanies.clear();`);
    const html = h.run('reportsPage()');
    assert.equal((html.match(/class="chart-point /g)||[]).length,count*12,`${range}-day chart`);
    const exactTable = html.slice(html.indexOf('Exact daily values'));
    assert.equal((exactTable.match(/<tr>/g)||[]).length,1+count*12,`${range}-day table`);
    await h.run("action('report-csv')");
    const rows = h.context.captured.at(-1).data.split('\r\n');
    assert.equal(rows.length,1+count*12,`${range}-day CSV`);
  }
});

test('daily changes use the preceding close outside the selected window and retain cent precision', async () => {
  const h = harness();
  h.run("selectedCompanies.add('company-1'); reportRange=7; report='dailySales';");
  const html = h.run('reportsPage()');
  assert.match(html.slice(html.indexOf('Exact daily values')), /<td>100\.01<\/td>/);
  assert.equal((html.match(/· €100\.01"/g)||[]).length,7);
  await h.run("action('report-csv')");
  for (const row of h.context.captured.at(-1).data.split('\r\n').slice(1)) assert.ok(row.endsWith(',"100.01"'));
  h.run("report='dailyProduction';");
  await h.run("action('report-csv')");
  for (const row of h.context.captured.at(-1).data.split('\r\n').slice(1)) assert.ok(row.endsWith(',"7"'));
});

test('negative financial exports stay numeric while untrusted formula-like text remains escaped', () => {
  const h = harness();
  h.run(`csv('numbers.csv', [[-123.45,0,123.45,'=1+1','-123.45','+1','@SUM(A1:A2)','A "quoted" team']]);`);
  const data = h.context.captured.at(-1).data;
  assert.ok(data.startsWith('"-123.45","0","123.45",'));
  assert.match(data, /"'=1\+1","'-123\.45","'\+1","'@SUM\(A1:A2\)"/);
  assert.ok(data.endsWith('"A ""quoted"" team"'));
});

test('carbon report tables suppress binary floating-point tails without changing exported values', async () => {
  const h = harness();
  h.run("report='emissions'; reportRange=7; selectedCompanies.add('company-1'); state.snapshots.at(-2).companies[0].emissions=184.32000000000002; state.snapshots.at(-1).companies[0].emissions=2925.7999999999997;");
  const html = h.run('reportsPage()');
  const exactTable = html.slice(html.indexOf('Exact daily values'));
  assert.match(exactTable, /<td>184\.32<\/td>/);
  assert.match(exactTable, /<td>2,925\.8<\/td>/);
  assert.doesNotMatch(exactTable, /184\.32000000000002|2,925\.7999999999997/);
  assert.equal(h.run("reportValue(100.01, 'EUR')"), '100.01');
  assert.equal(h.run("reportValue(192, 'modules')"), '192');
  assert.equal(h.run("reportValue(100/12, '%')"), '8.3333');
  await h.run("action('report-csv')");
  const rows = h.context.captured.at(-1).data.split('\r\n');
  assert.ok(rows.at(-2).endsWith(',"184.32000000000002"'));
  assert.ok(rows.at(-1).endsWith(',"2925.7999999999997"'));
});

test('completed instructor preview exports the complete balanced ledger with numeric credits', async () => {
  const h = harness();
  // Simulate a long journal with balanced transactions beyond the 100 visible rows.
  h.run(`for(let i=1;i<=150;i++) state.company.ledger.push({hour:i,description:'Synthetic expense '+i,lines:{expense:101,cash:-101}});`);
  const html = h.run('financePage()');
  assert.match(html,/Show latest 100 entries \(151 total\)/);
  assert.match(html,/data-action="loan"[^>]*disabled/);
  assert.match(html,/data-action="ledger-csv"/);
  await h.run("action('ledger-csv')");
  const rows = h.context.captured.at(-1).data.split('\r\n').slice(1);
  assert.equal(rows.length,304); // Four opening postings plus 150 debit/credit pairs.
  const amounts = rows.map(row=>Number(row.match(/,"([^"]+)"$/)[1]));
  assert.ok(amounts.every(Number.isFinite),'every exported debit and credit must be numeric');
  assert.ok(Math.abs(amounts.reduce((a,b)=>a+b,0))<1e-8);
});

test('partial current days do not reduce the last seven completed daily reports', async () => {
  const h = harness(); h.run("state.hour += 12; reportRange=7; report='dailyProduction'; selectedCompanies.add('company-2');");
  const html = h.run('reportsPage()');
  assert.equal((html.match(/class="chart-point /g)||[]).length,7);
  await h.run("action('report-csv')");
  const rows = h.context.captured.at(-1).data.split('\r\n').slice(1);
  assert.equal(rows.length,7); assert.ok(rows.every(row=>row.endsWith(',"8"')));
});
