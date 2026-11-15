import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {TestClassroom} from '../src/test-classroom.mjs';
import {createSession} from '../src/engine.mjs';
import {testTemplate} from '../server/test-template.mjs';

const workerSource = (await readFile(new URL('../src/test-worker.mjs',import.meta.url),'utf8')).replace(/^import [^\n]*\n/,'');
function worker(disk) {
  let failSave = false;
  const context = vm.createContext({onconnect:null,setInterval:()=>{},Date,TestClassroom,
    durable:async (method,value) => {
      if (failSave && ['put','delete'].includes(method)) throw new Error('Storage full');
      if (method === 'put') disk.set(value.state.id,structuredClone(value));
      if (method === 'get') return structuredClone(disk.get(value));
      if (method === 'getAll') return structuredClone([...disk.values()]);
      if (method === 'delete') disk.delete(value);
    }});
  vm.runInContext(workerSource+'\nstorage = durable;',context);
  return {fail(){failSave=true;},port(credentials={}) {
    const messages=[], port={postMessage:m=>messages.push(m),start(){},close(){}};
    context.onconnect({ports:[port]});
    return async (action,payload) => {await port.onmessage({data:{requestId:'request',action,payload,...credentials}}); const response=messages.filter(m=>m.requestId).at(-1);if(response.error)throw Object.assign(new Error(response.error),{status:response.status});return response.result;};
  }};
}
test('worker restart retains students, links, decisions, receipts and source; deletion is permanent', async () => {
  const disk=new Map(), first=worker(disk), create=first.port();
  const template=testTemplate(createSession(),createSession({name:'Practice source'}));
  const credentials=await create('create',{template,groups:[{name:'Alpha',students:2}],metadata:{owner:'teacher',source:'source'}});
  const teacher=first.port(credentials), people=await teacher('roster');
  const student=first.port({roomId:credentials.roomId,key:people[1].key});
  const request={key:'saved-purchase',revision:0,command:{type:'purchase',supplierId:'frame-circular',qty:10}};
  const receipt=await student('command',request);
  await teacher('command',{key:'start-clock',revision:1,command:{type:'clock',status:'running',secondsPerHour:4}});
  const second=worker(disk), resumed=second.port(credentials);
  assert.deepEqual(await resumed('roster'),people);
  const view=await resumed('view');assert.equal(view.state.status,'paused');assert.equal(view.state.hour,0);
  const resumedStudent=second.port({roomId:credentials.roomId,key:people[1].key});
  assert.equal((await resumedStudent('view')).state.company.purchases.length,1);
  assert.deepEqual(await resumedStudent('command',request),receipt);
  assert.equal((await second.port()('list',{owner:'teacher',source:'source'})).length,1);
  assert.equal((await second.port()('list',{owner:'other'})).length,0);
  await assert.rejects(resumedStudent('end'),/Instructor/);
  await resumed('end');assert.equal(disk.size,0);
  await assert.rejects(worker(disk).port(credentials)('view'),e=>e.status===410);
});
test('failed durable writes are not acknowledged and roll back decisions', async () => {
  const disk=new Map(), runtime=worker(disk);
  const template=testTemplate(createSession(),createSession());
  const credentials=await runtime.port()('create',{template,groups:[{name:'Alpha',students:1}]});
  const teacher=runtime.port(credentials), before=await teacher('view');
  runtime.fail();
  await assert.rejects(teacher('command',{key:'failed-step',revision:0,command:{type:'step',hours:1}}),/Storage full/);
  assert.deepEqual(await teacher('view'),before);
  await assert.rejects(teacher('end'),/Storage full/);assert.equal(disk.size,1);
});
