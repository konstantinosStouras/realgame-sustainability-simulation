import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';
import { createCloudHandler } from '../server/cloud-http.mjs';

test('cloud HTTP lifecycle and template endpoints enforce roles, preserve results and revoke archived access', async () => {
  const db=new MemoryFirestore(),store=new FirestoreStore(db);
  const server=http.createServer(createCloudHandler({store,projectId:'test',allowedOrigins:[],verifyFirebase:async token=>({uid:token,name:'Synthetic '+token,email_verified:true,instructor:token==='teacher'})}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const call=async(path,user='teacher',body)=>{
    const response=await fetch(origin+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+user,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json()};
  };
  try {
    const created=await call('/sessions','teacher',{name:'Disposable test'}),id=created.body.id;
    const roster=await call('/sessions/'+id+'/roster');
    await call('/join','student',{code:roster.body.invites[0].code});
    assert.equal((await call('/sessions/'+id+'/test-template','student')).status,403);
    const before=JSON.stringify([...db.data]);
    const template=await call('/sessions/'+id+'/test-template');
    assert.equal(template.status,200);assert.equal(template.body.companyNames.length,3);
    assert.equal(JSON.stringify([...db.data]),before,'reading test setup must not create accounts or persist any test state');
    assert.equal((await call('/sessions/'+id+'/command','student',{key:'deny-delete',revision:0,command:{type:'deleteSession'}})).status,403);
    const close={key:'http-close',revision:0,command:{type:'closeSession'}};
    assert.equal((await call('/sessions/'+id+'/command','teacher',close)).status,200);
    const finalStudent=await call('/sessions/'+id,'student');
    assert.equal(finalStudent.status,200);assert.equal(finalStudent.body.state.status,'completed');
    assert.equal((await call('/sessions/'+id,'teacher')).body.state.status,'completed');
    assert.equal((await call('/sessions/'+id+'/command','student',{key:'closed-decision',revision:1,command:{type:'deposit',amount:10000,weeks:1}})).status,409);
    const deletion={key:'http-delete',revision:1,command:{type:'deleteSession'}};
    const result=await call('/sessions/'+id+'/command','teacher',deletion);
    assert.deepEqual(await call('/sessions/'+id+'/command','teacher',deletion),result);
    assert.equal((await call('/sessions/'+id,'student')).status,404);
    assert.equal((await call('/sessions/'+id+'/test-template')).status,404);
    assert.equal((await call('/me','student')).body.sessions.length,0);
    assert.ok((await store.sessionRef(id).get()).exists,'archiving retains underlying records');
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
