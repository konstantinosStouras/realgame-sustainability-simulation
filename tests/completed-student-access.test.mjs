import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';
import { publicView } from '../src/engine.mjs';

for (const cloud of [false,true]) test(`${cloud ? 'Firestore' : 'SQLite'} completed members retain final reports without new decisions or membership`,async()=>{
  const store=cloud?new FirestoreStore(new MemoryFirestore()):new Store(':memory:');
  const make=(id,role='student')=>cloud?{id,name:id,role}:store.addUser(id,id,'synthetic-test-password',role);
  const teacher=make('teacher','instructor'),student=make('student'),outsider=make('outsider');
  const view=async(user,id)=>cloud?store.view(user,id):{actor:store.actor(user,id),state:publicView(store.session(id),store.actor(user,id))};
  try {
    const session=await store.create(teacher,{id:'completed-reports',days:1,companyNames:['First','Second']});
    const code=(await store.roster(teacher,session.id)).invites[0].code;
    await store.enter(student,session.id,code);
    const deposit={key:'accepted-deposit',revision:0,command:{type:'deposit',amount:100000,term:168}};
    const receipt=await store.command(student,session.id,deposit);
    await store.command(teacher,session.id,{key:'finish-one-day',revision:1,command:{type:'step',hours:24}});
    assert.deepEqual(await store.enter(student,session.id),{sessionId:session.id});
    const final=await view(student,session.id);
    assert.equal(final.state.status,'completed');assert.equal(final.state.snapshots.length,1);
    assert.ok(final.state.company.ledger.length>1);assert.equal(final.state.company.deposits.length,1);
    assert.ok(final.state.companies.every(c=>!Object.hasOwn(c,'accounts')));
    for(const type of ['purchase','dispatch','offer','shifts','staff','loan','deposit','energy','invest','reorder','budget','message']) {
      await assert.rejects(async()=>store.command(student,session.id,{key:`blocked-${type}`,revision:final.state.revision,command:{type,channel:`team:${final.actor.companyId}`,text:'Blocked'}}),{status:409});
    }
    assert.deepEqual(await store.command(student,session.id,deposit),receipt,'retrying an old accepted decision only returns its receipt');
    assert.deepEqual((await view(student,session.id)).state,final.state,'no rejected decision changes final results');
    await assert.rejects(async()=>view(outsider,session.id),{status:403});
    await assert.rejects(async()=>store.enter(outsider,session.id,code),{status:403});
    await assert.rejects(async()=>store.join(outsider,code),{status:403});
    await store.command(teacher,session.id,{key:'revoke-report-access',revision:final.state.revision,command:{type:'configure',studentAccess:false}});
    await assert.rejects(async()=>view(student,session.id),{status:403});
    await assert.rejects(async()=>store.enter(student,session.id),{status:403});
    assert.equal((await view(teacher,session.id)).state.status,'completed');
  } finally {if(!cloud)store.close();}
});
