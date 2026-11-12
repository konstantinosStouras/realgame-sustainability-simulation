import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';

for (const cloud of [false, true]) test(`${cloud ? 'Firestore' : 'SQLite'} session IDs, entry, isolation and closed access`, async () => {
  const store = cloud ? new FirestoreStore(new MemoryFirestore()) : new Store(':memory:');
  const teacher = cloud ? {id:'teacher',role:'instructor'} : store.addUser('teacher','Teacher','test-password','instructor');
  const student = cloud ? {id:'student',role:'student'} : store.addUser('student','Student','test-password');
  const outsider = cloud ? {id:'outsider',role:'student'} : store.addUser('outsider','Outsider','test-password');
  const reject = fn => assert.rejects(async () => fn());
  const view = (user,id) => cloud ? store.view(user,id) : store.actor(user,id);
  try {
    const a = await store.create(teacher,{id:'class-a'}), b = await store.create(teacher,{id:'class-b'});
    assert.equal(a.id,'class-a');
    await reject(() => store.create(teacher,{id:'class-a'}));
    await reject(() => store.create(teacher,{id:'../invalid'}));
    await reject(() => store.create(student,{id:'UNAUTHORIZED'}));
    await reject(() => store.enter(student,'missing'));
    assert.deepEqual(await store.enter(student,a.id),{requiresCompanyCode:true});
    await reject(() => view(student,a.id));
    const code = (await store.roster(teacher,a.id)).invites[0].code;
    await reject(() => store.enter(student,b.id,code));
    assert.deepEqual(await store.enter(student,a.id,code),{sessionId:a.id});
    assert.deepEqual(await store.enter(student,a.id),{sessionId:a.id});
    await view(student,a.id);
    await reject(() => view(student,b.id));
    await store.command(teacher,a.id,{key:'close-access',revision:0,command:{type:'configure',studentAccess:false}});
    await reject(() => store.enter(student,a.id));
    await reject(() => store.join(outsider,code));
    await reject(() => view(student,a.id));
    await reject(() => store.command(student,a.id,{key:'closed-write',revision:1,command:{type:'message',channel:'announcements',text:'No access'}}));
    await view(teacher,a.id);
    await store.command(teacher,a.id,{key:'reopen-access',revision:1,command:{type:'configure',studentAccess:true}});
    await view(student,a.id);
    assert.deepEqual(await store.enter(student,a.id),{sessionId:a.id});
  } finally { if (!cloud) store.close(); }
});
