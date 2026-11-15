import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';
import { TestClassroom } from '../src/test-classroom.mjs';
import { typingPresence } from '../src/typing-presence.mjs';

const instructor = { id: 'teacher', name: 'Taylor Morgan', role: 'instructor' };
async function setup() {
  let now = 1000;
  const db = new MemoryFirestore(), store = new FirestoreStore(db, { now: () => now });
  const otherInstance = new FirestoreStore(db, { now: () => now });
  const session = await store.create(instructor, { companyNames: ['One', 'Two'] });
  const students = ['a', 'b', 'c'].map(id => ({ id, name: id, role: 'student' }));
  const invites = (await store.roster(instructor, session.id)).invites;
  for (const [i, student] of students.entries()) await store.join(student, invites[i === 2 ? 1 : 0].code);
  return { store, otherInstance, session, students, db, now: value => { now = value; } };
}
test('typing crosses server instances but stays within a team, excludes self and expires', async () => {
  const {store,otherInstance,session,students:[a,b,c],now} = await setup();
  const before = await store.replay(instructor, session.id);
  assert.deepEqual(await store.typing(a,session.id,true), {typing:false});
  assert.deepEqual(await otherInstance.typing(b,session.id), {typing:true});
  assert.deepEqual(await otherInstance.typing(c,session.id), {typing:false});
  assert.deepEqual(await otherInstance.typing(a,session.id), {typing:false});
  await store.typing(a,session.id,false);
  assert.deepEqual(await otherInstance.typing(b,session.id), {typing:false});
  await store.typing(a,session.id,true);
  now(7001);
  assert.deepEqual(await otherInstance.typing(b,session.id), {typing:false});
  assert.deepEqual(await store.replay(instructor,session.id),before,'presence never enters the simulation or audit');
});
test('typing reauthorizes membership, session access and messaging permissions', async () => {
  const {store,session,students:[a],db} = await setup();
  await assert.rejects(store.typing({id:'outsider',role:'student'},session.id,true),{status:403});
  await assert.rejects(store.typing(instructor,session.id,true),{status:403});
  await assert.rejects(store.typing(a,session.id,'draft text'),{status:400});
  const ref=store.sessionRef(session.id), original=(await ref.get()).data();
  for (const change of [{studentAccess:false},{status:'completed'},{status:'deleted'},{messaging:{visible:true,allowed:false}},{messaging:{visible:false,allowed:true}}]) {
    await ref.set({...original,...change});
    await assert.rejects(store.typing(a,session.id,true));
  }
  await ref.set(original);
  db.data.delete(store.memberRef(session.id,a.id).path);
  await assert.rejects(store.typing(a,session.id),{status:403});
});
test('typing works for existing session metadata and isolates concurrent senders', async () => {
  const {store,session,students:[a,b,c]}=await setup();
  const ref=store.sessionRef(session.id), metadata=(await ref.get()).data();delete metadata.messaging;await ref.set(metadata);
  await Promise.all([store.typing(a,session.id,true),store.typing(b,session.id,true)]);
  await store.typing(a,session.id,false);
  assert.deepEqual(await store.typing(a,session.id),{typing:true});
  assert.deepEqual(await store.typing(b,session.id),{typing:false});
  assert.deepEqual(await store.typing(c,session.id),{typing:false});
});
test('temporary test rooms use the same private expiring typing behavior', () => {
  const room=new TestClassroom({name:'Preview'},[{name:'One',students:2},{name:'Two',students:1}]);
  const [teacher,a,b,c]=room.people, revision=room.state.revision;
  room.typing(a.key,true,1000);
  assert.deepEqual(room.typing(b.key,undefined,2000),{typing:true});
  assert.deepEqual(room.typing(c.key,undefined,2000),{typing:false});
  assert.deepEqual(room.typing(b.key,undefined,7000),{typing:false});
  assert.throws(()=>room.typing(teacher.key,true),{status:403});
  assert.equal(room.state.revision,revision);
});
test('presence never stores draft text or arbitrary request fields', () => {
  const result=typingPresence([], {id:'one',role:'student',companyId:'team'}, {status:'paused',features:{messaging:{allowed:true,visible:true}}},true,100);
  assert.deepEqual(result.entries,[{id:'one',until:6100}]);
});
