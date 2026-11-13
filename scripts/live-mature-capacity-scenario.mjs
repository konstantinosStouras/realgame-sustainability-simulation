import assert from 'node:assert/strict';
import {FirestoreStore} from '../server/firestore-store.mjs';
import {encodeState,decodeState} from '../server/cloud-state.mjs';
import {assertInvariants,profit,applyCommand} from '../src/engine.mjs';
import {assertOneRecoveryDeposit} from './live-recovery-scenario.mjs';

export async function runMatureCapacityScenario(ctx,{seedState:source,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),cacheExpiryMs=31000,watchLeadMs=1000}={}){
 const {run,students,teacher,endpoint,call,requireOk,db,checks,summary,session,samples}=ctx;
 assert.equal(students.length,120);assert.equal(session.id,run);assert.match(run,/^load-\d+-[a-f0-9]+$/);
 assert.ok(source,'A synthetic mature seedState is required');
 const mature=structuredClone(source);
 assert.equal(mature.companies.length,12);assert.equal(mature.hour,1440);assert.equal(mature.status,'completed');assertInvariants(mature);
 // This is a newly owned synthetic fixture, not a modification of the saved
 // original classroom. Retain ledgers/contracts/reports and unique-ID sequence;
 // make its complete mature baseline also its initial replay state.
 mature.id=run;mature.name=`Disposable mature capacity ${run}`;mature.revision=0;mature.audit=[];mature.messages=[];
 const store=new FirestoreStore(db),ref=store.sessionRef(run),initial=encodeState(mature);
 const {chunks,...initialInfo}=initial;
 await db.runTransaction(async tx=>{
  const doc=await tx.get(ref);assert.ok(doc.exists);const metadata=doc.data();
  assert.equal(metadata.ownerId,`firebase:${teacher.uid}`);assert.equal(metadata.revision,0);assert.equal(metadata.hour,0);
  const commands=await tx.get(ref.collection('commands'));assert.equal(commands.docs.length,0);
  chunks.forEach((data,i)=>tx.set(ref.collection('initialChunks').doc(String(i)),{data}));
  for(let i=chunks.length;i<metadata.initial.chunkCount;i++)tx.delete(ref.collection('initialChunks').doc(String(i)));
  store.writeState(tx,ref,mature,{...metadata,initial:{...initialInfo,chunkCount:chunks.length}},null);
 });
 const persisted=()=>db.runTransaction(async tx=>{
  const metadata=(await tx.get(ref)).data();assert.equal(metadata.ownerId,`firebase:${teacher.uid}`);
  const docs=await tx.getAll(...Array.from({length:metadata.chunkCount},(_,i)=>ref.collection('stateChunks').doc(String(i))));
  return decodeState(docs.map(d=>Buffer.from(d.data().data)),metadata);
 },{readOnly:true});
 const seeded=await persisted();assert.deepEqual(seeded,mature);
 const reopened=requireOk(await call('mature-public-reopen',endpoint+'/command',teacher,{key:`${run}-mature-open`,revision:0,command:{type:'configure',endHour:1464,studentAccess:true}},15000));
 assert.equal(reopened.revision,1);
 const expectedConflicts=new WeakSet(),waves=[];checks.matureCapacity={waves,students:120,teams:12,sourceHour:1440,sourceRawBytes:Buffer.byteLength(JSON.stringify(source||mature)),seedRawBytes:Buffer.byteLength(JSON.stringify(mature)),seedCompressedBytes:initialInfo.bytes,seedChunks:chunks.length};
 for(let wave=1;wave<=3;wave++){
  if(wave>1){console.log(`Expiring decoded snapshot cache before mature wave ${wave}.`);await wait(cacheExpiryMs);}
  const before=await persisted();assert.equal(before.status,'paused');assert.equal(before.hour,1440);assertInvariants(before);
  const watchPhase=`mature-${wave}-watches-120`,viewPhase=`mature-${wave}-views-120`,decisionPhase=`mature-${wave}-decisions-120`,retryPhase=`mature-${wave}-retries-120`;
  const watches=Promise.allSettled(students.map((who,i)=>call(watchPhase,endpoint+`/updates?revision=${before.revision}&wait=${run}-${wave}-${i}`,who,undefined,45000)));
  try {
  await wait(watchLeadMs);
  // Validate and discard each response promptly instead of retaining120large
  // parsed client views, which would confuse harness memory with server memory.
  await Promise.all(students.map(async(who,i)=>{
   const view=requireOk(await call(viewPhase,endpoint,who,undefined,15000)).state,company=before.companies[i%12];
   assert.equal(view.revision,before.revision);assert.equal(view.company.id,company.id);
   assert.deepEqual(view.company.accounts,company.accounts);assert.equal(view.company.profit,profit(company));
   assert.deepEqual(view.snapshots,before.snapshots);assert.ok(view.companies.every(c=>!Object.hasOwn(c,'cash')));
  }));
  const viewStats=summary(viewPhase);assert.ok(viewStats.max<15000);
  const requests=students.map((_,i)=>({key:`${run}-mature-${wave}-${i}`,revision:before.revision,command:{type:'deposit',amount:10000+wave*120+i,term:24}}));
  const results=await Promise.all(students.map((who,i)=>call(decisionPhase,endpoint+'/command',who,requests[i],15000)));
  assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,119);
  for(const sample of samples.filter(s=>s.phase===decisionPhase&&s.status===409)){sample.expected=true;expectedConflicts.add(sample);}
  const decisionStats=summary(decisionPhase);assert.ok(decisionStats.max<15000);
  const winner=results.findIndex(r=>r.status===200),receipt=requireOk(results[winner]);
  const updates=await watches;for(const update of updates){assert.equal(update.status,'fulfilled');assert.ok(requireOk(update.value).revision>=receipt.revision);}
  const watchStats=summary(watchPhase);assert.ok(watchStats.max<45000);
  const after=await persisted();assertOneRecoveryDeposit(before,after,winner,requests[winner].command.amount);
  const duplicates=await Promise.all(Array.from({length:120},()=>call(retryPhase,endpoint+'/command',students[winner],requests[winner],15000)));
  for(const duplicate of duplicates)assert.deepEqual(requireOk(duplicate),receipt);
  const retryStats=summary(retryPhase);assert.ok(retryStats.max<15000);assert.deepEqual(await persisted(),after);
  waves.push({wave,beforeRevision:before.revision,afterRevision:after.revision,viewStats,decisionStats,watchStats,retryStats,exactlyOneEffect:true});
  console.log(JSON.stringify({phase:'mature-wave-complete',wave,revision:after.revision}));
  } finally {
   // Even if a view/decision assertion fails, settle every bounded watch before
   // the shared runner starts deleting the synthetic fixture and identities.
   await watches;
  }
 }
 const final=await persisted();assert.equal(final.revision,4);assert.equal(final.hour,1440);assert.equal(final.status,'paused');assertInvariants(final);
 const receipts=await db.collection('studioRequests').where('sessionId','==',run).get();assert.equal(receipts.docs.length,4);
 const replay=requireOk(await call('mature-coherent-replay',endpoint+'/replay',teacher,undefined,15000));
 assert.deepEqual(replay.initial,mature);assert.equal(replay.commands.length,4);
 const rebuilt=structuredClone(replay.initial);
 for(const record of replay.commands)applyCommand(rebuilt,record.actor,record.command,record.realAt,{replay:true});
 assert.deepEqual(JSON.parse(JSON.stringify(rebuilt)),final,'Mature initial baseline and subsequent API commands must replay exactly');
 checks.unexpectedFailures=samples.filter(s=>(s.status===0||s.status>=400)&&!expectedConflicts.has(s)).length;assert.equal(checks.unexpectedFailures,0);
 checks.browserDeadlineOverruns=samples.filter(s=>s.ms>=(s.phase.includes('-watches-')?45000:15000)).length;assert.equal(checks.browserDeadlineOverruns,0);
 Object.assign(checks.matureCapacity,{passed:true,acceptedDeposits:3,receipts:4,finalRevision:4,unchangedClosedReports:true,replayExact:true});
}
