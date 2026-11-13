import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryFirestore} from './helpers/memory-firestore.mjs';
import {FirestoreStore} from '../server/firestore-store.mjs';
import {createSession,applyCommand} from '../src/engine.mjs';
import {runMatureCapacityScenario} from '../scripts/live-mature-capacity-scenario.mjs';

async function fixture({heartbeat=false}={}){
 const db=new MemoryFirestore(),store=new FirestoreStore(db,{now:()=>0}),run='load-123456-abcdef12';
 const teacher={id:'firebase:synthetic-teacher',uid:'synthetic-teacher',role:'instructor',name:'Synthetic teacher'};
 const names=Array.from({length:12},(_,i)=>`Synthetic team ${i}`);
 const session=await store.create(teacher,{id:run,companyNames:names,days:61});
 const roster=await store.roster(teacher,run),students=[];
 for(let i=0;i<120;i++){const user={id:`synthetic-student-${i}`,role:'student',name:`Synthetic student ${i}`};await store.join(user,roster.invites[i%12].code);students.push(user);}
 const seedState=createSession({id:'synthetic-old-class',companyNames:names,days:60});
 while(seedState.hour<1440)applyCommand(seedState,teacher,{type:'step',hours:Math.min(168,1440-seedState.hour)});
 const samples=[],checks={},watches=[],heartbeatSent=new Set();
 const ctx={run,session,teacher,students,db,samples,checks,endpoint:`/sessions/${run}`,
  requireOk:r=>{assert.equal(r.status,200);return r.value;},
  summary:phase=>({phase,requests:samples.filter(s=>s.phase===phase).length,max:1}),
  async call(phase,path,who,body,timeout){
   if(path.includes('/updates?'))assert.ok(timeout>0&&timeout<=35000);else assert.equal(timeout,15000);
   if(path.includes('/updates?')){
    const key=phase+who.id;
    if(heartbeat&&!heartbeatSent.has(key)){heartbeatSent.add(key);samples.push({phase,status:200,ms:1});return {status:200,value:{revision:Number(new URL(path,'https://test.invalid').searchParams.get('revision'))}};}
    return new Promise(resolve=>watches.push(revision=>{samples.push({phase,status:200,ms:1});resolve({status:200,value:{revision}});}));
   }
   let result;
   try{const value=body?await store.command(who,run,body):path.endsWith('/replay')?await store.replay(who,run):await store.view(who,run);result={status:200,value};}
   catch(error){result={status:error.status||500,value:{error:error.message}};}
   samples.push({phase,status:result.status,ms:1});
   if(body&&result.status===200)for(const notify of watches.splice(0))notify(result.value.revision);
   return result;
  }};
 return{ctx,store,seedState:JSON.parse(JSON.stringify(seedState))};
}

test('mature capacity rehearsal preserves economics, coherent initial replay and120watchers across three waves',async()=>{
 const f=await fixture(),original=structuredClone(f.seedState),waits=[];
 await runMatureCapacityScenario(f.ctx,{seedState:f.seedState,wait:async ms=>{waits.push(ms);}});
 assert.deepEqual(f.seedState,original,'seeding must never mutate the supplied saved fixture');
 assert.equal(f.ctx.checks.matureCapacity.passed,true);assert.equal(f.ctx.checks.matureCapacity.replayExact,true);
 assert.equal(f.ctx.checks.matureCapacity.waves.length,3);
 assert.deepEqual(waits,[1000,31000,1000,31000,1000]);
 for(const part of ['views','watches','decisions','retries'])assert.equal(f.ctx.samples.filter(s=>s.phase.includes(`-${part}-120`)).length,360);
 assert.equal(f.ctx.samples.filter(s=>s.status===409&&s.expected).length,357);
 assert.equal(f.ctx.checks.unexpectedFailures,0);assert.equal(f.ctx.checks.browserDeadlineOverruns,0);
 const final=(await f.store.readViewSnapshot(f.ctx.teacher,f.ctx.run)).state;
 assert.equal(final.revision,4);assert.equal(final.hour,1440);assert.equal(final.endHour,1464);
 assert.deepEqual(final.snapshots,original.snapshots);
});

test('mature seeding refuses a session owned by another identity before any write',async()=>{
 const f=await fixture(),ref=f.store.sessionRef(f.ctx.run),before=(await ref.get()).data();
 await assert.rejects(runMatureCapacityScenario({...f.ctx,teacher:{...f.ctx.teacher,uid:'different-owner'}},{seedState:f.seedState,wait:async()=>{}}));
 assert.deepEqual((await ref.get()).data(),before);assert.equal(f.ctx.samples.length,0);
});

test('unchanged heartbeats reconnect with the same cursor and every student still observes the committed revision',async()=>{
 const f=await fixture({heartbeat:true});
 await runMatureCapacityScenario(f.ctx,{seedState:f.seedState,wait:async()=>{}});
 assert.equal(f.ctx.checks.matureCapacity.passed,true);
 assert.equal(f.ctx.samples.filter(s=>s.phase.includes('-watches-120')).length,720);
 for(const wave of f.ctx.checks.matureCapacity.waves){assert.equal(wave.heartbeatReconnects,120);assert.equal(wave.watchClients,120);assert.ok(wave.maxWatchConvergenceMs<45000);}
});
