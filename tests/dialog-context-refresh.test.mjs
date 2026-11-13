import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

const source=readFileSync(new URL('../app.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').split('\nawait startWorkspace();')[0];
function storage(){const data=new Map();return{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};}
function control(value=''){return{value,innerHTML:'',textContent:'',validationMessage:'',setCustomValidity(message){this.validationMessage=message;}};}
function harness(){
 const fields={'[name=qty]':control('30'),'[name=routeId]':control('rail'),'#dispatch-context':control(),'#dispatch-terms':control(),'#dispatch-quote':control(),'#purchase-context':control(),'#purchase-quote':control()};
 const listeners={},form={querySelector:s=>fields[s],addEventListener:(type,fn)=>{listeners[type]=fn;}},dialog={open:true,querySelector:()=>form,close(){this.open=false;}};
 const document={activeElement:fields['[name=qty]'],querySelector:s=>s==='#dialog'?dialog:s==='#app'?{}:null,addEventListener(){}};
 const ctx=vm.createContext({document,URL,AbortSignal,location:{hostname:'localhost',href:'http://localhost/'},localStorage:storage(),sessionStorage:storage(),crypto:{randomUUID},setTimeout:()=>1,clearTimeout(){},firebaseConfig:{},classroomBackend:'',FormData:class extends Map{constructor(){super([['qty',fields['[name=qty]'].value],['routeId',fields['[name=routeId]'].value]]);}},itemName:()=> 'frame',renders:0});
 vm.runInContext(source,ctx);
 const run=code=>vm.runInContext(code,ctx);
 run(`actor={id:'synthetic-student',role:'student',companyId:'company-1'};user=actor;sessionId='synthetic-session';
  render=()=>{renders++;};updateConnectionNotice=()=>{};ensureSessionUpdates=()=>{};toast=()=>{};
  modal=(title,content,submit)=>{dialog.open=true;globalThis.lastTitle=title;globalThis.lastContent=content;globalThis.lastSubmit=submit;};`);
 const state={revision:1,hour:24,startDate:'2026-01-01T00:00:00Z',company:{id:'company-1',inventory:{panel:{qty:372}},orders:[{id:'order-110',originalQty:90,remaining:90,dueAt:84,payment:72}]},catalog:{routes:[{id:'rail',name:'Rail',enabled:true,hours:48,fixed:8000,unit:80,term:48,carbonFixed:30,carbonUnit:.2,reliability:95,maxDelay:6},{id:'road',name:'Road',enabled:true,hours:24,fixed:5000,unit:100,term:24,carbonFixed:40,carbonUnit:.3,reliability:90,maxDelay:4}],suppliers:[{id:'frame-circular',name:'Circular frames',item:'frame',enabled:true,price:1800,fee:4500,min:10,lot:1,stock:1000,lead:48,term:120,carbon:2,freight:.3}]}};
 ctx.initial=state;run('state=initial;');
 return{ctx,run,state,fields,form,dialog,document,listeners};
}

test('409 refresh updates dispatch facts and current quote without replacing quantity or route draft',async()=>{
 const h=harness(),qty=h.fields['[name=qty]'],route=h.fields['[name=routeId]'];
 h.run("openDispatch('order-110')");
 assert.match(h.fields['#dispatch-context'].textContent,/Stock available: 372/);
 assert.match(h.fields['#dispatch-quote'].innerHTML,/104\.00/);
 const fresh=structuredClone(h.state);fresh.revision=2;fresh.hour=48;fresh.company.inventory.panel.qty=341;fresh.company.orders[0].remaining=59;fresh.catalog.routes[0].unit=100;
 h.ctx.apiImplementation=async path=>{if(path.endsWith('/command'))throw Object.assign(new Error('Session changed. Review refreshed state.'),{status:409});return{state:fresh,actor:{id:'synthetic-student',role:'student',companyId:'company-1'}};};
 h.run('api=apiImplementation;');
 await assert.rejects(h.run("command({type:'dispatch',orderId:'order-110',qty:30,routeId:'rail'})"),{status:409});
 assert.equal(h.run('state.revision'),2);assert.equal(h.dialog.open,true);assert.equal(h.ctx.renders,0);
 assert.equal(h.fields['[name=qty]'],qty);assert.equal(h.fields['[name=routeId]'],route);assert.equal(qty.value,'30');assert.equal(route.value,'rail');
 assert.equal(qty.max,'59');assert.match(h.fields['#dispatch-context'].textContent,/Still to dispatch: 59\. Stock available: 341/);
 assert.match(h.fields['#dispatch-quote'].innerHTML,/110\.00/);assert.match(h.fields['#dispatch-quote'].innerHTML,/Expected late/);
 assert.equal(h.document.activeElement,qty);
});

test('depleted stock and unavailable routes preserve draft values and prevent invalid resubmission',()=>{
 const h=harness();h.run("openDispatch('order-110')");
 h.state.company.inventory.panel.qty=0;h.state.company.orders[0].remaining=0;h.state.catalog.routes[0].enabled=false;
 h.form.refreshContext();
 assert.equal(h.fields['[name=qty]'].value,'30');assert.equal(h.fields['[name=routeId]'].value,'rail');
 assert.equal(h.fields['[name=qty]'].max,'0');assert.match(h.fields['[name=qty]'].validationMessage,/no remaining/);
 assert.match(h.fields['[name=routeId]'].validationMessage,/available/);assert.match(h.fields['[name=routeId]'].innerHTML,/Previously selected route unavailable/);
 assert.match(h.fields['#dispatch-context'].textContent,/Stock available: 0/);assert.match(h.fields['#dispatch-quote'].textContent,/unavailable/);
 h.state.company.orders=[];h.form.refreshContext();assert.match(h.fields['#dispatch-context'].textContent,/no longer available/);
});

test('purchase context refresh uses current supplier terms, stock and time while preserving entered quantity',async()=>{
 const h=harness();h.fields['[name=qty]'].value='100';h.run("openPurchase('frame-circular')");
 const fresh=structuredClone(h.state);fresh.revision=2;fresh.hour=48;
 Object.assign(fresh.catalog.suppliers[0],{price:2000,fee:6000,stock:50,min:5,lot:5,lead:24});
 h.ctx.apiImplementation=async path=>{if(path.endsWith('/command'))throw Object.assign(new Error('Stale purchase'),{status:409});return{state:fresh,actor:{id:'synthetic-student',role:'student',companyId:'company-1'}};};h.run('api=apiImplementation;');
 await assert.rejects(h.run("command({type:'purchase',supplierId:'frame-circular',qty:100})"),{status:409});
 assert.equal(h.fields['[name=qty]'].value,'100');assert.equal(h.fields['[name=qty]'].max,'50');assert.equal(h.fields['[name=qty]'].min,'5');assert.equal(h.fields['[name=qty]'].step,'5');
 assert.match(h.fields['#purchase-context'].textContent,/20\.00 per unit/);assert.match(h.fields['#purchase-context'].textContent,/Supplier stock available: 50/);
 assert.match(h.fields['#purchase-quote'].textContent,/2,060\.00/);
 fresh.catalog.suppliers[0].enabled=false;h.form.refreshContext();assert.match(h.fields['[name=qty]'].validationMessage,/unavailable/);
});

test('background refresh during editing remains deferred until an explicit authoritative refresh',async()=>{
 const h=harness();h.run("openDispatch('order-110')");
 const fresh=structuredClone(h.state);fresh.revision=2;fresh.company.inventory.panel.qty=341;
 h.ctx.apiImplementation=async()=>({state:fresh,actor:{id:'synthetic-student',role:'student',companyId:'company-1'}});h.run('api=apiImplementation;');
 await h.run('load(false)');assert.equal(h.run('state.revision'),1);assert.match(h.fields['#dispatch-context'].textContent,/Stock available: 372/);
 await h.run('load(false,true)');assert.equal(h.run('state.revision'),2);assert.match(h.fields['#dispatch-context'].textContent,/Stock available: 341/);
 assert.equal(h.fields['[name=qty]'].value,'30');assert.equal(h.fields['[name=routeId]'].value,'rail');
});

test('live completion retires an open decision draft and renders the final report workspace',async()=>{
 const h=harness();h.run("openDispatch('order-110')");
 const fresh=structuredClone(h.state);fresh.revision=2;fresh.status='completed';
 h.ctx.apiImplementation=async()=>({state:fresh,actor:{id:'synthetic-student',role:'student',companyId:'company-1'}});h.run('api=apiImplementation;');
 await h.run('load(false)');
 assert.equal(h.run('state.status'),'completed');assert.equal(h.dialog.open,false);assert.equal(h.ctx.renders,1);
 assert.equal(h.run("permitted('offers')"),false);
});
