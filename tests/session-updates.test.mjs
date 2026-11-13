import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { waitForSessionUpdate } from '../server/session-updates.mjs';
import { watchSession } from '../src/session-updates.mjs';
import { FirestoreStore } from '../server/firestore-store.mjs';

// Protocol stubs only: no accounts, simulation state, persistence or network.
function reference() {
  let notify, removed = 0;
  return { onSnapshot(fn) { notify = fn; return () => removed++; },
    emit(data) { notify({ exists: !!data, data: () => data }); },
    get removed() { return removed; } };
}
test('committed revisions wake listeners immediately and expose only revision', async () => {
  const ref = reference(); const pending = waitForSessionUpdate(ref, 1, true);
  ref.emit({ revision: 1 });
  ref.emit({ revision: 2, privateField: 'must not escape' });
  assert.deepEqual(await pending, { revision: 2 }); assert.equal(ref.removed, 1);
});
test('closure, deletion, access removal and disconnect release listeners', async () => {
  for (const metadata of [{status:'completed'}, {status:'deleted'}, {studentAccess:false}, null]) {
    const ref = reference(), pending = waitForSessionUpdate(ref, 1, true);
    ref.emit(metadata); assert.deepEqual(await pending, {closed:true}); assert.equal(ref.removed,1);
  }
  const ref=reference(), controller=new AbortController();
  const pending=waitForSessionUpdate(ref,1,true,controller.signal);
  controller.abort(); assert.deepEqual(await pending,{cancelled:true}); assert.equal(ref.removed,1);
});
test('unchanged listeners expire cleanly; instructors retain closed results', async () => {
  const ref=reference(), pending=waitForSessionUpdate(ref,1,false,undefined,5);
  ref.emit({status:'completed',revision:1});
  assert.deepEqual(await pending,{revision:1});assert.equal(ref.removed,1);
});
test('membership authorization runs before installing a Firestore listener', async () => {
  let listened=false;
  const fake={db:{runTransaction:fn=>fn({})},actor:async()=>{throw Object.assign(new Error('Denied'),{status:403});},sessionRef(){listened=true;}};
  await assert.rejects(FirestoreStore.prototype.updates.call(fake,{},'protocol',1), {status:403});
  assert.equal(listened,false);
});
test('closed-session commands are rejected before receipts or economic state are read', async () => {
  let stateRead=false;
  const fake={
    memberRef:()=> 'member',sessionRef:()=> 'metadata',requests:{doc:()=> 'receipt'},
    actor:FirestoreStore.prototype.actor,
    readState(){stateRead=true;throw new Error('Must not read economic state');},
    db:{runTransaction:fn=>fn({get:async ref=> {
      assert.notEqual(ref,'receipt');
      return {exists:true,data:()=>ref==='member'?{companyId:'protocol'}:{status:'completed',studentAccess:false}};
    }})}
  };
  await assert.rejects(FirestoreStore.prototype.command.call(fake,{id:'protocol',role:'student'},'protocol', {key:'protocol-only',revision:1,command:{type:'ignored'}}),{status:403});
  assert.equal(stateRead,false);
});
test('browser reconnects with new revision and handles closure without polling delay', async () => {
  const urls=[],events=[];
  const watch=watchSession({url:'https://invalid/updates',token:async()=>'mock',revision:1,
    changed:()=>events.push('changed'),closed:()=>events.push('closed'),
    fetcher:async(url,options)=>{urls.push(url);assert.equal(options.headers.Authorization,'Bearer mock');return {ok:true,status:200,json:async()=>urls.length===1?{revision:2}:{closed:true}};}});
  await watch.task;assert.deepEqual(events,['changed','closed']);assert.match(urls[1],/revision=2$/);
});
test('browser clears denied sessions and ignores responses after navigation', async () => {
  for(const status of [401,403,404]) {
    let closed=0;
    const watch=watchSession({url:'https://invalid',token:async()=>'mock',revision:1,changed(){},closed(){closed++;},fetcher:async()=>({status})});
    await watch.task;assert.equal(closed,1);
  }
  let resolve,closed=0;
  const response=new Promise(r=>{resolve=r});
  const watch=watchSession({url:'https://invalid',token:async()=>'mock',revision:1,changed(){},closed(){closed++;},fetcher:()=>response});
  await Promise.resolve();watch.stop();resolve({status:403});await watch.task;assert.equal(closed,0);
});
test('closed real-session UI clears decisions, dialog, and stale-load generation', async () => {
  const source=await readFile(new URL('../app.mjs',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('function clearClosedSession()'),source.indexOf('function ensureSessionUpdates()'));
  let stopped=0, message='';
  const ctx=vm.createContext({stopSessionUpdates(){stopped++;},loadSequence:1,state:{},actor:{},sessionId:'protocol',roster:[],dialog:{open:true,close(){this.open=false;}},renderLobby(text){message=text;}});
  vm.runInContext(fn+'\nclearClosedSession();',ctx);
  for(const key of ['state','actor','sessionId','roster'])assert.equal(ctx[key],null);
  assert.equal(ctx.dialog.open,false);assert.equal(ctx.loadSequence,2);assert.equal(stopped,1);assert.match(message,/Further decisions are blocked/);
});
