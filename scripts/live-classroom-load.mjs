// Explicitly invoked production probe. Credentials are injected by a private runner.
// Creates only synthetic accounts and one disposable session; never enumerates real classrooms.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import https from 'node:https';
import { gunzipSync } from 'node:zlib';
import { digest, decodeState } from '../server/cloud-state.mjs';
import { assertInvariants } from '../src/engine.mjs';

export async function runLiveLoad({ admin, db, apiKey, base, output, manifest, scenario, sessionOptions = {} }) {
  assert.match(base, /^https:\/\/[a-z0-9.-]+\/api$/);
  const run = `load-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const identities = [], sessions = [], samples = [], checks = {};
  // Bounded sockets represent 120 students, each with a watch and an API call.
  // Native HTTP exposes transport error codes instead of fetch's generic failure.
  // The runner's network has no IPv6 route. Pin transport to IPv4 so Node's
  // 250ms address-family race cannot mislabel a slow TCP handshake as API failure.
  const agent = new https.Agent({ keepAlive: true, maxSockets: 240, family: 4 });
  let manifestWrite = Promise.resolve();
  const saveManifest = () => { const contents=JSON.stringify({run,identities,sessions}); return manifestWrite=manifestWrite.then(()=>writeFile(manifest,contents)); };
  const limit = async (items, concurrency, fn) => {
    let next = 0; const results = [];
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
    })); return results;
  };
  async function identity(i) {
    const uid = `${run}-${i}`, email = `${uid}@example.invalid`, password = randomBytes(24).toString('hex');
    identities.push(uid); await saveManifest();
    await admin.createUser({ uid, email, password, emailVerified: true, displayName: `Synthetic load participant ${i}` });
    if (i === 0) await admin.setCustomUserClaims(uid, { instructor: true });
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Synthetic sign-in failed: ${response.status} ${data.error?.message}`);
    return { uid, token: data.idToken };
  }
  async function call(phase, path, who, body, timeout = 45000) {
    const start = performance.now(); let status = 0, value, wireBytes, decodedBytes, encoding;
    try {
      const response = await new Promise((resolve,reject)=>{
        const request=https.request(base+path,{agent,method:body===undefined?'GET':'POST',headers:{Origin:'https://www.stouras.com','Content-Type':'application/json','Accept-Encoding':'gzip',...(who?{Authorization:`Bearer ${who.token}`}:{})},signal:AbortSignal.timeout(timeout)},res=>{
          const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>{try{const bytes=Buffer.concat(chunks),decoded=res.headers['content-encoding']==='gzip'?gunzipSync(bytes):bytes;resolve({status:res.statusCode,text:decoded.toString('utf8'),bytes:bytes.length,encoding:res.headers['content-encoding']||'identity'});}catch(e){reject(e);}});
        });request.on('error',reject);request.end(body===undefined?undefined:JSON.stringify(body));
      });
      status = response.status; wireBytes=response.bytes;decodedBytes=Buffer.byteLength(response.text);encoding=response.encoding;value = JSON.parse(response.text);
    } catch (e) { value = { error: `${e.name}: ${e.code || e.cause?.code || e.message}` }; }
    samples.push({ phase, status, ms: Math.round(performance.now() - start),wireBytes,decodedBytes,encoding, ...(status >= 500 || !status ? { error: value.error } : {}) });
    return { status, value };
  }
  const requireOk = r => { assert.ok(r.status >= 200 && r.status < 300, `Unexpected status ${r.status}: ${JSON.stringify(r.value)}`); return r.value; };
  const summary = phase => {
    const rows = samples.filter(s => s.phase === phase), sorted = rows.map(s => s.ms).sort((a,b)=>a-b);
    const percentile = p => sorted[Math.min(sorted.length-1, Math.ceil(sorted.length*p)-1)];
    const result = { phase, requests: rows.length, statuses: rows.reduce((a,s)=>(a[s.status]=(a[s.status]||0)+1,a),{}), p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),max:sorted.at(-1) };
    const errors=rows.filter(s=>s.error).reduce((a,s)=>(a[s.error]=(a[s.error]||0)+1,a),{});
    console.log(JSON.stringify({...result,...(Object.keys(errors).length?{errors}:{})})); return result;
  };
  let failure;
  try {
    const health = requireOk(await call('health','/health')); assert.equal(health.persistence,'firestore');
    console.log('Creating 121 synthetic verified Firebase identities.');
    const teacher = await identity(0);
    const students = await limit(Array.from({length:120},(_,i)=>i+1),5,identity);
    // Manifest the chosen ID before the POST: a lost create response must not
    // leave an untracked classroom behind after a successful server commit.
    sessions.push(run); await saveManifest();
    const session = requireOk(await call('create','/sessions',teacher,{name:`Disposable live test ${run}`,companyNames:Array.from({length:12},(_,i)=>`Synthetic team ${i+1}`),days:14,...sessionOptions,id:run}));
    assert.equal(session.id,run);const endpoint=`/sessions/${session.id}`;
    const roster = requireOk(await call('roster',endpoint+'/roster',teacher));
    const joins = await limit(students,12,(student,i)=>call('join','/join',student,{code:roster.invites.find(x=>x.companyId===`company-${i%12+1}`).code}));
    joins.forEach(requireOk); summary('join');
    const members=requireOk(await call('roster',endpoint+'/roster',teacher)).members;
    assert.equal(members.length,121);for(let i=1;i<=12;i++)assert.equal(members.filter(m=>m.companyId===`company-${i}`).length,10);
    checks.membership=true;
    if(scenario) await scenario({run,students,teacher,endpoint,call,requireOk,checks,db,summary,session,samples});
    else {
    for (const n of [12,60,120]) {
      const phase=`read-${n}`; await Promise.all(students.slice(0,n).map(s=>call(phase,endpoint,s))); summary(phase);
    }
    const view=requireOk(await call('review',endpoint,teacher));
    const requests=students.map((_,i)=>({key:`${run}-deposit-${i}`,revision:view.state.revision,command:{type:'deposit',amount:10000,term:24}}));
    const burst=await Promise.all(students.map((s,i)=>call('decision-burst',endpoint+'/command',s,requests[i])));summary('decision-burst');
    assert.equal(burst.filter(r=>r.status===200).length,1);
    // Explicit reviewed retries, never silently rebase a student's command.
    console.log('Reviewing and retrying conflicting synthetic decisions.');
    for(let i=0;i<students.length;i++)if(burst[i].status!==200){
      requests[i].revision=requireOk(await call('review',endpoint,students[i])).state.revision;
      requireOk(await call('reviewed-decision',endpoint+'/command',students[i],requests[i]));
      if(i%30===0)console.log(`Reviewed ${i}/120 decisions`);
    }
    summary('reviewed-decision');
    const duplicates=await Promise.all(students.map((s,i)=>call('duplicate-burst',endpoint+'/command',s,requests[i])));summary('duplicate-burst');
    checks.duplicateResponses=duplicates.every(r=>r.status===200);
    const confirmed=requireOk(await call('review',endpoint,teacher));assert.equal(confirmed.state.revision,120);
    const receipts=await db.collection('studioRequests').where('sessionId','==',session.id).get();assert.equal(receipts.size,120);checks.exactlyOnce=true;
    // Model 120 connected tabs: notification request plus a full read every three seconds.
    console.log('Holding 120 update subscriptions with three overlapping polling rounds.');
    const watches=students.map((s,i)=>call('watch-idle',endpoint+`/updates?revision=120&wait=${run}-idle-${i}`,s,undefined,45000));
    const rounds=[1000,4000,7000].map(async delay=>{await new Promise(r=>setTimeout(r,delay));return Promise.all(students.map(s=>call('read-with-watch',endpoint,s)));});
    await Promise.all(rounds);summary('read-with-watch');await Promise.all(watches);summary('watch-idle');
    // Running-clock contention; all readers must see a valid monotonically advanced state.
    requireOk(await call('clock-start',endpoint+'/command',teacher,{key:`${run}-clock`,revision:120,command:{type:'clock',status:'running',secondsPerHour:1}}));
    await new Promise(r=>setTimeout(r,2200));
    await Promise.all(students.map(s=>call('running-read-120',endpoint,s)));summary('running-read-120');
    const running=requireOk(await call('review',endpoint,teacher));
    requireOk(await call('clock-pause',endpoint+'/command',teacher,{key:`${run}-pause`,revision:running.state.revision,command:{type:'clock',status:'paused'}}));
    checks.runningClock=true;
    const final=requireOk(await call('review',endpoint,teacher));
    const replay=requireOk(await call('replay',endpoint+'/replay',teacher));
    checks.uniqueTicks=new Set(replay.commands.filter(c=>c.command.type==='tick').map(c=>c.realAt)).size===replay.commands.filter(c=>c.command.type==='tick').length;
    checks.finalHour=final.state.hour;
    console.log('Testing 12 competing offers, market allocation and notification fan-out.');
    let revision=final.state.revision;
    for(let i=0;i<12;i++){
      const result=requireOk(await call('competitive-offer',endpoint+'/command',students[i],{key:`${run}-offer-${i}`,revision,command:{type:'offer',offerId:'local-standard',price:24000+i*700,min:1,max:500,delivery:60,payment:72,enabled:true}}));
      revision=result.revision;
    }
    const notificationStart=performance.now();
    const notifications=students.map((s,i)=>call('watch-change',endpoint+`/updates?revision=${revision}&wait=${run}-change-${i}`,s));
    await new Promise(r=>setTimeout(r,2000));
    const step=requireOk(await call('market-day',endpoint+'/command',teacher,{key:`${run}-market-day`,revision,command:{type:'step',hours:24}}));
    const changed=await Promise.all(notifications);checks.notificationFanout=changed.filter(r=>r.status===200&&r.value.revision>=step.revision).length;
    checks.notificationWaveMs=Math.round(performance.now()-notificationStart);summary('watch-change');
    const matureViews=await Promise.all(students.map(s=>call('market-read-120',endpoint,s)));summary('market-read-120');
    checks.privateCompanyViews=matureViews.every((r,i)=>r.status===200&&r.value.state.company.id===`company-${i%12+1}`);
    const ref=db.collection('studioSessions').doc(session.id),metadata=(await ref.get()).data();
    const chunks=await db.getAll(...Array.from({length:metadata.chunkCount},(_,i)=>ref.collection('stateChunks').doc(String(i))));
    const persisted=decodeState(chunks.map(d=>Buffer.from(d.data().data)),metadata);assertInvariants(persisted);
    checks.persistedInvariants=true;checks.marketOrders=persisted.companies.reduce((n,c)=>n+c.orders.length,0);
    checks.unexpectedFailures=samples.filter(s=>s.status===0||(s.status>=400&&!(s.phase==='decision-burst'&&s.status===409))).length;
    assert.equal(checks.unexpectedFailures,0,'Unexpected transport or HTTP failures');
    assert.equal(checks.duplicateResponses,true);assert.equal(checks.uniqueTicks,true);
    assert.equal(checks.notificationFanout,120);assert.equal(checks.privateCompanyViews,true);
    assert.ok(checks.marketOrders>0,'Competing offers must produce market orders');
    }
  } catch(e){failure=e.message;console.log(`Probe failed: ${failure}`);}
  finally {
    const phases=[...new Set(samples.map(s=>s.phase))].map(summary);
    const saveResults=()=>writeFile(output,JSON.stringify({run,startedAt:new Date(Number(run.split('-')[1])).toISOString(),checks,failure,phases,samples},null,2));
    await saveResults();
    console.log('Removing only this run’s synthetic session and identities.');
    for(const id of sessions){
      const ref=db.collection('studioSessions').doc(id),doc=await ref.get();
      if(doc.exists)assert.equal(doc.data().ownerId,`firebase:${run}-0`,'Refuse to delete a session outside this run');
      await db.recursiveDelete(ref);
      for(const name of ['studioMembers','studioInvites','studioRequests']){
        const docs=await db.collection(name).where('sessionId','==',id).get();await limit(docs.docs,10,d=>d.ref.delete());
      }
    }
    await limit(identities,10,async uid=>{assert.ok(uid.startsWith(run+'-'));await db.collection('studioUsers').doc(digest('firebase:'+uid)).delete();});
    // One explicit batch avoids the low per-second single-account delete quota.
    const deletion=await admin.deleteUsers(identities);
    assert.equal(deletion.failureCount,0,'Synthetic identity batch cleanup failed; retain manifest for recovery.');
    checks.cleaned=true;
    await saveResults();
    await writeFile(manifest,JSON.stringify({run,identities:[],sessions:[],cleaned:true}));
    agent.destroy();await db.terminate();console.log('Synthetic resources removed; aggregate measurements saved.');
  }
  if(failure)throw new Error(failure);
}
