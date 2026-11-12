import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/main.mjs';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';
import { createCloudHandler } from '../server/cloud-http.mjs';
for(const kind of ['local','cloud']) test(kind + ': native export returns a complete named attachment and rejects unauthorized forms', async()=>{
 const store=kind==='local'?new Store(':memory:'):new FirestoreStore(new MemoryFirestore());
 const teacher=kind==='local'?store.addUser('teacher','Teacher','synthetic-password','instructor'):await store.firebaseUser({uid:'teacher',name:'Teacher',email_verified:true,instructor:true});
 const student=kind==='local'?store.addUser('student','Student','synthetic-password'):await store.firebaseUser({uid:'student',name:'Student',email_verified:true});
 const teacherToken=kind==='local'?store.issueToken(teacher.id).token:'teacher', studentToken=kind==='local'?store.issueToken(student.id).token:'student';
 const session=await store.create(teacher,{id:'qa-native-export'});
 await store.command(teacher,session.id,{key:'export-step-test',revision:0,command:{type:'step',hours:1}});
 const server=kind==='local'?createApp({store,projectId:''}).server:http.createServer(createCloudHandler({store,projectId:'test',allowedOrigins:['https://www.stouras.com'],verifyFirebase:async token=>{if(!['teacher','student'].includes(token)) throw Object.assign(new Error('Invalid token'),{status:401});return {uid:token,name:token,email_verified:true,instructor:token==='teacher'};}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const call=(token,id=session.id,extra={})=>fetch(origin+'/api/export-download',{method:'POST',body:new URLSearchParams({token,session:id}),...extra});
 try {
  const response=await call(teacherToken), body=await response.text();
  assert.equal(response.status,200);assert.equal(response.headers.get('content-disposition'),'attachment; filename="session-'+session.id+'.json"');
  assert.equal(Number(response.headers.get('content-length')),Buffer.byteLength(body));assert.equal(response.headers.get('cache-control'),'no-store');
  const data=JSON.parse(body);assert.equal(data.initial.id,session.id);assert.equal(data.commands[0].command.hours,1);assert.equal(data.complete,true);
  assert.equal((await call(studentToken)).status,403);assert.equal((await call('')).status,401);assert.equal((await call('invalid')).status,401);
  assert.equal((await call(teacherToken,'bad\"id')).status,404);
  assert.equal((await call(teacherToken,session.id,{headers:{Origin:'https://evil.invalid'}})).status,403);
  assert.equal((await fetch(origin+'/api/export-download?token='+teacherToken)).status,405);
  assert.equal((await store.list(teacher))[0].hour,1,'export does not mutate the session');
 } finally {await new Promise(r=>server.close(r));if(kind==='local')store.close();}
});
