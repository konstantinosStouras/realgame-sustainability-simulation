import test from 'node:test';
import assert from 'node:assert/strict';
import {FirestoreStore} from '../server/firestore-store.mjs';
import {MemoryFirestore} from './helpers/memory-firestore.mjs';
import {createSession,publicViewJSON} from '../src/engine.mjs';

const teacher={id:'teacher',role:'instructor',name:'Synthetic instructor'};
async function fixture({sameTeam=false,...options}={}){
 let now=0;
 const db=new MemoryFirestore(),store=new FirestoreStore(db,{now:()=>now,...options});
 const {id}=await store.create(teacher,{companyNames:Array.from({length:12},(_,i)=>`Synthetic team ${i+1}`)});
 const roster=await store.roster(teacher,id),students=[];
 for(let i=0;i<120;i++){
  const user={id:`student-${i}`,role:'student',name:`Synthetic student ${i} ☀`};
  await store.join(user,roster.invites[sameTeam?0:i%12].code);students.push(user);
 }
 return{db,store,id,students,now:value=>{now=value;}};
}
function countSerializations(state){
 const counts=state.companies.map(()=>0);
 state.companies.forEach((company,i)=>{
  const ledger=company.ledger;
  Object.defineProperty(company,'ledger',{enumerable:true,get(){counts[i]++;return ledger;}});
 });
 return counts;
}

test('120 same-company callers serialize state once but each receives its own fresh actor envelope',async()=>{
 const f=await fixture({sameTeam:true}),{state}=await f.store.readViewSnapshot(f.students[0],f.id),counts=countSerializations(state);
 const results=await Promise.all(f.students.map(user=>f.store.viewJSON(user,f.id,'company-2')));
 assert.equal(counts[0],1);assert.equal(f.store.viewJSONCache.size,1);
 for(let i=0;i<results.length;i++){
  const view=JSON.parse(results[i]);assert.equal(view.actor.id,f.students[i].id);assert.equal(view.actor.name,f.students[i].name);
  assert.equal(view.state.company.id,'company-1');assert.ok(view.state.companies.every(c=>!Object.hasOwn(c,'cash')));
 }
 const renamed=JSON.parse(await f.store.viewJSON({...f.students[0],name:'New caller name'},f.id));
 assert.equal(renamed.actor.name,'New caller name');assert.equal(counts[0],1);
});

test('120 callers across12teams serialize12 private projections with exact uncached equivalence',async()=>{
 const f=await fixture();let revision=0;
 for(let i=0;i<12;i++)await f.store.command(f.students[i],f.id,{key:`private-team-message-${i}`,revision:revision++,command:{type:'message',channel:`team:company-${i+1}`,text:`Private team ${i+1} ☀`}});
 const {state}=await f.store.readViewSnapshot(teacher,f.id);
 const expected=f.students.slice(0,12).map((user,i)=>publicViewJSON(state,{...user,companyId:`company-${i+1}`}));
 const counts=countSerializations(state);
 for(let round=0;round<2;round++){
  const views=await Promise.all(f.students.map(user=>f.store.viewJSON(user,f.id)));
  for(let i=0;i<views.length;i++){
   const view=JSON.parse(views[i]);assert.deepEqual(view.state,JSON.parse(expected[i%12]));
   assert.equal(view.state.messages.length,1);assert.equal(view.state.messages[0].channel,`team:company-${i%12+1}`);
  }
 }
 assert.deepEqual(counts,Array(12).fill(1));assert.equal(f.store.viewJSONCache.size,12);
});

test('cached serialization cannot reuse membership, access, roles, instructor previews or older state content',async()=>{
 const f=await fixture(),user=f.students[0];
 const first=JSON.parse(await f.store.viewJSON(user,f.id));assert.equal(first.state.company.id,'company-1');
 await f.store.memberRef(f.id,user.id).set({sessionId:f.id,userId:user.id,companyId:'company-2'});
 assert.equal(JSON.parse(await f.store.viewJSON(user,f.id,'company-1')).state.company.id,'company-2');
 const elevated={...user,role:'instructor'};
 const instructor=JSON.parse(await f.store.viewJSON(elevated,f.id,'company-3'));
 assert.equal(instructor.state.company.id,'company-3');assert.ok(Object.hasOwn(instructor.state.companies[0],'cash'));
 assert.equal(JSON.parse(await f.store.viewJSON(elevated,f.id,'company-4')).state.company.id,'company-4');
 const demoted=JSON.parse(await f.store.viewJSON(user,f.id));assert.equal(demoted.state.company.id,'company-2');
 assert.ok(demoted.state.companies.every(c=>!Object.hasOwn(c,'cash')));
 await f.store.command(user,f.id,{key:'different-state-digest',revision:0,command:{type:'deposit',amount:123400,term:24}});
 const changed=JSON.parse(await f.store.viewJSON(user,f.id));assert.equal(changed.state.revision,1);assert.equal(changed.state.company.deposits.length,1);
 assert.equal(first.state.company.deposits.length,0);
 await f.store.sessionRef(f.id).set({studentAccess:false},{merge:true});
 await assert.rejects(f.store.viewJSON(user,f.id),{status:403});
 await assert.rejects(f.store.viewJSON({...user,id:'outsider'},f.id),{status:403});
 await f.store.sessionRef(f.id).set({studentAccess:true,status:'completed'},{merge:true});
 assert.equal(JSON.parse(await f.store.viewJSON(user,f.id)).state.company.id,'company-2');
 await assert.rejects(f.store.viewJSON({...user,id:'outsider'},f.id),{status:403});
});

test('serialized cache charges UTF8 bytes, expires, evicts LRU, bypasses oversize and never pins state references',()=>{
 let now=0;
 const store=new FirestoreStore(new MemoryFirestore(),{now:()=>now,viewCacheTtlMs:100});
 const state=createSession({companyNames:['Team ☀','Team 二','Team 🌱']}),counts=countSerializations(state);
 const actors=state.companies.map(c=>({role:'student',companyId:c.id}));
 const a=store.serializeViewState(state,actors[0]),b=store.serializeViewState(state,actors[1]);
 const aBytes=Buffer.byteLength(a),bBytes=Buffer.byteLength(b);
 assert.equal(store.viewJSONCacheBytes,aBytes+bBytes);assert.ok(aBytes>a.length,'UTF8 accounting includes multibyte text');
 store.viewJSONCacheMaxBytes=aBytes+bBytes;
 store.serializeViewState(state,actors[0]);assert.deepEqual(counts,[1,1,0]);
 store.serializeViewState(state,actors[2]);assert.ok(store.viewJSONCacheBytes<=store.viewJSONCacheMaxBytes);
 store.serializeViewState(state,actors[1]);assert.equal(counts[1],2,'least-recently-used projection was evicted');
 now=101;store.serializeViewState(state,actors[1]);assert.equal(counts[1],3,'expired entry was serialized again');
 assert.equal(store.viewJSONCache.size,1);
 store.viewJSONCacheMaxBytes=0;now=202;
 assert.equal(store.serializeViewState(state,actors[0]),a);assert.equal(store.serializeViewState(state,actors[0]),a);
 assert.equal(store.viewJSONCache.size,0);assert.equal(store.viewJSONCacheBytes,0);
 store.viewJSONCacheMaxBytes=24*1024*1024;
 for(let i=0;i<49;i++)store.serializeViewState(createSession({id:`snapshot-${i}`}),actors[0]);
 assert.equal(store.viewJSONCache.size,48);
 for(const [key,entry]of store.viewJSONCache){assert.deepEqual(Object.keys(key),[]);assert.deepEqual(Object.keys(entry).sort(),['bytes','expiresAt','json']);}
 assert.throws(()=>new FirestoreStore(new MemoryFirestore(),{viewJSONCacheMaxBytes:-1}));
});

test('uncached mutable publicView results remain isolated from cached serialized responses',async()=>{
 const f=await fixture(),user=f.students[0];
 const json=await f.store.viewJSON(user,f.id),view=await f.store.view(user,f.id);
 view.state.company.accounts.cash=-1;view.state.company.ledger.length=0;view.actor.name='Changed locally';
 assert.equal(await f.store.viewJSON(user,f.id),json);
});
