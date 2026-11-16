import { operationalReports, buildOperationalReport, businessUpdates } from '../src/operational-reports.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as engine from '../src/engine.mjs';
const source=readFileSync(new URL('../app.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').split('\nawait startWorkspace();')[0];
const decode=s=>s.replace(/&(quot|amp|lt|gt|#39);/g,(_,e)=>({quot:'"',amp:'&',lt:'<',gt:'>','#39':"'"})[e]);
function harness(){
 const context=vm.createContext({ operationalReports, buildOperationalReport, businessUpdates, ...engine,URL,location:{hostname:'localhost'},classroomBackend:'',firebaseConfig:{},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null},document:{querySelector:()=>({}),addEventListener(){}}});
 vm.runInContext(source,context);const run=code=>vm.runInContext(code,context);
 const session=engine.createSession(),actor={id:'student',role:'student',companyId:session.companies[0].id};
 engine.applyCommand(session,{id:'teacher',role:'instructor'},{type:'step',hours:72});
 context.view=engine.publicView(session,actor);context.player=actor;
 run('state=view; actor=player; sessionId=state.id;');
 return {run,context};
}
function parsedRows(html){return [...html.matchAll(/<tr data-sort-original="(\d+)">([\s\S]*?)<\/tr>/g)].map(([,index,body])=>({index:Number(index),html:body,values:[...body.matchAll(/<td data-sort-value="([^"]*)">/g)].map(m=>JSON.parse(decode(m[1])))}));}
function sort(h,headers,column){h.context.headers=headers;h.context.column=column;h.run('constKey=tableKey(headers); constNext=nextTableSort(tableSorts.get(constKey),column); if(constNext)tableSorts.set(constKey,constNext);else tableSorts.delete(constKey);');}
// Real DOM movement is covered by the browser smoke check. This fixture isolates
// row identity, header state and the absence of simulation commands/re-rendering.
function domTable(h,values){
 const headings=values[0].map(()=>({attrs:{},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]}}));
 const rows=values.map((row,i)=>({dataset:{sortOriginal:String(i)},cells:row.map(v=>({dataset:{sortValue:JSON.stringify(v)}})),action:{orderId:'order-'+i}}));
 const body={rows,append(...ordered){this.rows=ordered}};
 const element={dataset:{sortTable:'fixture'},tBodies:[body],querySelectorAll:()=>controls};
 const controls=headings.map((heading,i)=>({dataset:{tableSort:String(i),sortLabel:'Column '+i},icon:{textContent:''},closest:name=>name==='table'?element:heading,querySelector(){return this.icon},setAttribute(k,v){this[k]=v}}));
 h.context.controls=controls;
 return {body,headings,controls,rows};
}
test('DOM clicks cycle descending, ascending, original and keep each action with its row',()=>{
 const h=harness(),d=domTable(h,[['A',10],['B',100],['C',-5],['D',10]]);
 h.run('sortTable(controls[1])');assert.deepEqual(d.body.rows.map(r=>r.action.orderId),['order-1','order-0','order-3','order-2']);assert.equal(d.headings[1].attrs['aria-sort'],'descending');assert.equal(d.controls[1].icon.textContent,'▼');
 h.run('sortTable(controls[1])');assert.deepEqual(d.body.rows.map(r=>r.action.orderId),['order-2','order-0','order-3','order-1']);assert.equal(d.controls[1].icon.textContent,'▲');
 h.run('sortTable(controls[1])');assert.deepEqual(d.body.rows,d.rows);assert.equal(d.headings[1].attrs['aria-sort'],undefined);assert.equal(d.controls[1].icon.textContent,'');
 h.run('sortTable(controls[1]);sortTable(controls[0])');assert.equal(d.controls[1].icon.textContent,'');assert.equal(d.headings[0].attrs['aria-sort'],'descending');assert.equal(h.run('tableSorts.size'),1);
});
test('missing values stay last in both directions; zero and negative values remain numeric',()=>{
 const h=harness(),d=domTable(h,[[null],[0],[-5],[1000],[null]]);
 h.run('sortTable(controls[0])');assert.deepEqual(d.body.rows.map(r=>r.dataset.sortOriginal),['3','1','2','0','4']);
 h.run('sortTable(controls[0])');assert.deepEqual(d.body.rows.map(r=>r.dataset.sortOriginal),['2','1','3','0','4']);
});
test('raw numeric precision and simulation dates determine order rather than formatted strings',()=>{
 const h=harness();h.run("sampleHeaders=['Price','Date']; sampleRows=[[sortCell('€1.00',100.4),sortCell('31 Jan, 23:00',743)],[sortCell('€1.00',100.1),sortCell('1 Feb, 00:00',744)]];");
 sort(h,['Price','Date'],0);assert.deepEqual(parsedRows(h.run('table(sampleHeaders,sampleRows)')).map(r=>r.index),[0,1]);
 sort(h,['Price','Date'],0);assert.deepEqual(parsedRows(h.run('table(sampleHeaders,sampleRows)')).map(r=>r.index),[1,0]);
 sort(h,['Price','Date'],1);assert.deepEqual(parsedRows(h.run('table(sampleHeaders,sampleRows)')).map(r=>r.index),[1,0]);
});
test('orders use creation time, retain quantities and action IDs, and do not mutate the engine',()=>{
 const h=harness();h.run("state.company.orders=[{id:'order-100',createdAt:1,dueAt:80,originalQty:9,remaining:8,received:1,price:100,customer:'First'},{id:'order-2',createdAt:2,dueAt:75,originalQty:3,remaining:3,received:0,price:100,customer:'Second'}];before=JSON.stringify(state);");
 const headers=['Order / market','Original','To dispatch','Received','Promised arrival',''];
 sort(h,headers,0);sort(h,headers,0);
 const html=h.run('ordersPanel(true)'),rows=parsedRows(html);
 assert.match(rows[0].html,/data-id="order-100"/);assert.deepEqual(rows[0].values.slice(0,5),[1,9,8,1,80]);
 assert.match(html,/aria-sort="ascending"/);assert.equal((html.match(/data-table-sort=/g)||[]).length,5);assert.equal(h.run('JSON.stringify(state)===before'),true);
 assert.match(html,/sort by order creation time/);
});
test('selected sort survives refreshed rows; reset restores the current default order; scope is isolated',()=>{
 const h=harness();sort(h,['Value'],0);
 assert.deepEqual(parsedRows(h.run('table(["Value"],[[3],[10],[1]])')).map(r=>r.values[0]),[10,3,1]);
 assert.deepEqual(parsedRows(h.run('table(["Value"],[[3],[10],[1],[20]])')).map(r=>r.values[0]),[20,10,3,1]);
 h.run("preview='company-other'");assert.deepEqual(parsedRows(h.run('table(["Value"],[[3],[10],[1]])')).map(r=>r.values[0]),[3,10,1]);
 h.run("preview=undefined");sort(h,['Value'],0);sort(h,['Value'],0);
 assert.deepEqual(parsedRows(h.run('table(["Value"],[[3],[10],[1],[20]])')).map(r=>r.values[0]),[3,10,1,20]);
 assert.notEqual(h.run("tableKey(['Name'],'catalog-suppliers')"),h.run("tableKey(['Name'],'catalog-routes')"));
});
test('inventory, suppliers, routes, offers and report columns expose raw numeric/date keys',()=>{
 const h=harness();
 for(const [fn,columns] of [['inventoryPanel(true)',[1,2,3,4,5]],['suppliersPanel(true)',[1,2,3,4,5,6]],['logisticsPanel(true)',[1,2,3,4,5]],['offersPanel(true)',[1,2,3,4]]]){
  const rows=parsedRows(h.run(fn));assert.ok(rows.length,fn);
  for(const row of rows)for(const c of columns)assert.ok(row.values[c]===null||typeof row.values[c]==='number',fn+' column '+c);
 }
 const reports=parsedRows(h.run('reportsPage()'));assert.ok(reports.length);for(const row of reports){assert.equal(typeof row.values[0],'number');assert.equal(typeof row.values[2],'number');}
});
test('purchase and shipment pending dates remain empty sort keys, while actual dates are numeric',()=>{
 const h=harness();h.run("state.company.purchases=[{id:'purchase-10',qty:20,cost:1234,expectedAt:744,receivedAt:null,paidAt:null,item:'cell'}];state.company.shipments=[{id:'shipment-10',orderId:'order-1',qty:20,route:'Rail',dispatchedAt:743,expectedAt:779,receivedAt:null,paidAt:null}];");
 assert.deepEqual(parsedRows(h.run('purchasesPanel(true)'))[0].values.slice(1),[20,1234,744,null,null]);
 assert.deepEqual(parsedRows(h.run('shipmentsPanel(true)'))[0].values.slice(1),[20,'Rail',743,null,null]);
});
test('finance values, energy tariffs and audit times use raw values with clear combined-column hints',()=>{
 const h=harness();h.run("state.company.forecast=[{hour:744,description:'Repayment',amount:-10001}];state.company.loans=[{id:'loan-1',amount:100001,interest:501,fundedAt:25,paidAt:null}];state.company.deposits=[{id:'deposit-1',amount:200000,interest:50,placedAt:26,term:168,maturedAt:null}];");
 const finance=parsedRows(h.run('financePage()'));assert.deepEqual(finance[0].values,[744,'Repayment',-10001,'Scheduled']);assert.deepEqual(finance[1].values,['loan-1',100001,501,25,null]);assert.deepEqual(finance[2].values,['deposit-1',200000,50,26,194]);
 const energy=parsedRows(h.run('energyPage()'));assert.equal(typeof energy[0].values[1],'number');assert.match(h.run('energyPage()'),/sort by 00–08 tariff/);
 h.run("actor={id:'teacher',role:'instructor'};state.audit=[{hour:743,realAt:'2026-12-01T01:00:00Z',actorName:'Test',role:'student',command:{type:'offer'},result:'Accepted'}]");
 assert.equal(parsedRows(h.run('adminPage()'))[0].values[0],743);
});
test('plain identifiers sort naturally, names are decoded, and row data cannot inject markup',()=>{
 const h=harness();assert.ok(h.run("compareTableValues('order-9','order-100','ascending')")<0);
 assert.equal(h.run("cellSortValue('A &amp; B<small>details</small>')"),'A & B');
 const html=h.run('table(["Name"],[[sortCell(esc(\'<script>alert(1)</script>\'),\'<script>alert(1)</script>\')]])');
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});

test('mobile record labels stay with their values and actions after sorting',()=>{
 const h=harness();
 h.run(`mobileHeaders=['Supplier & item','Quantity','']; mobileRows=[['Alpha',2,button('purchase','Order','alpha')],['Beta',10,button('purchase','Order','beta')]];`);
 sort(h,['Supplier & item','Quantity',''],1);
 const html=h.run('table(mobileHeaders,mobileRows)'),rows=parsedRows(html);
 assert.match(html,/class="responsive-table" role="table"/);
 assert.match(rows[0].html,/class="table-cell-label" aria-hidden="true">Supplier &amp; item<\/span><div class="table-cell-value">Beta<\/div>/);
 assert.match(rows[0].html,/>Quantity<\/span><div class="table-cell-value">10<\/div>/);
 assert.match(rows[0].html,/class="table-cell-label" aria-hidden="true"><\/span><div class="table-cell-value"><button[^>]*data-id="beta"/);
 assert.match(rows[1].html,/data-id="alpha"/);
 assert.equal(h.run('table(["Name"],[])').includes('responsive-table'),false);
});
