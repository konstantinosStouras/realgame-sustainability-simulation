import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';
import { sessionId } from '../src/session-id.mjs';
test('IDs normalize and reject unsafe or invalid values', () => {
 assert.equal(sessionId(' London-2026 ',()=>''),'london-2026');
 assert.equal(sessionId(undefined,()=> 'legacy'),'legacy');
 for (const id of ['', 'ab', '../rome', 'new york', '-rome', 'rome-', 'a'.repeat(33), 42]) assert.throws(()=>sessionId(id,()=>''), {status:400});
});
for(const backend of ['sqlite','firestore']) test(backend + ' preserves names and IDs and rejects collisions without overwriting', async () => {
 const store=backend==='sqlite'?new Store(':memory:'):new FirestoreStore(new MemoryFirestore());
 const user=backend==='sqlite'?store.addUser('teacher','Teacher','test-password','instructor'):{id:'teacher',name:'Teacher',role:'instructor'};
 try {
 const s=await store.create(user,{id:' Rome ',name:'Morning class'});
 assert.equal(s.id,'rome');assert.equal(s.name,'Morning class');
 await assert.rejects(async()=>store.create(user,{id:'ROME',name:'Replacement'}),{status:409});
 assert.equal((await store.list(user))[0].name,'Morning class');
 assert.equal((await store.list(user)).length,1);
 } finally {store.db.close?.();}
});
