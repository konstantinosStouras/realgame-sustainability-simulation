import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Protocol-only fixtures: no simulation, student identity, storage or server is created.
test('worker pushes changes and terminal events only to authorized room ports', async () => {
  const source = (await readFile(new URL('../src/test-worker.mjs', import.meta.url),'utf8')).replace(/^import [^\n]*\n/, '');
  let tick;
  const context = vm.createContext({onconnect:null, setInterval:fn=>{tick=fn;}, Date, structuredClone});
  vm.runInContext(source + '\n storage = async () => undefined; globalThis.roomMap = rooms;', context);
  const room = {state:{revision:0,status:'running'}, snapshot(){return structuredClone({state:this.state});}, actor:key=>{if(key !== 'allowed') throw new Error('Denied');}, view:()=>({}), command(){this.state.revision++; return {};}, roster:()=>[], advance(){this.state.revision++;}};
  context.roomMap.set('fixture',room);
  async function port(key='allowed',roomId='fixture') {
    const messages=[];
    const p={postMessage:m=>messages.push(m),start(){},close(){}};
    context.onconnect({ports:[p]});
    const send=action=>p.onmessage({data:{requestId:action,action,roomId,key}});
    await send('view'); messages.length=0;
    return {messages,send};
  }
  const a=await port(), b=await port(), denied=await port('denied'), other=await port('allowed','other');
  await a.send('command');
  assert.equal(b.messages.at(-1).event,'changed');
  assert.equal(denied.messages.length,0); assert.equal(other.messages.length,0);
  await tick(); assert.equal(b.messages.filter(m=>m.event==='changed').length,2);
  await a.send('end');
  assert.equal(b.messages.at(-1).event,'ended'); assert.equal(context.roomMap.size,0);
  await b.send('view'); assert.equal(b.messages.at(-1).status,410);
  await tick(); assert.equal(b.messages.filter(m=>m.event==='changed').length,2);
});

test('client dispatches notifications separately from request responses and disconnects cleanly', async () => {
  const source = (await readFile(new URL('../src/test-client.mjs',import.meta.url),'utf8')).replace('export function','function').replace('import.meta.url', "'https://example.invalid/test-client.mjs'");
  const sent=[]; let port;
  const context=vm.createContext({URL,crypto:{randomUUID:()=> 'request'},setTimeout,clearTimeout,SharedWorker:class {constructor(){this.port=port={postMessage:m=>sent.push(m),start(){},close(){}};}}});
  vm.runInContext(source+'\nglobalThis.client = testClient({roomId:"fixture",key:"allowed"});',context);
  const events=[];context.client.subscribe(e=>events.push(e));
  const request=context.client.call('view');
  port.onmessage({data:{event:'changed',roomId:'other'}});
  port.onmessage({data:{event:'changed',roomId:'fixture'}});
  port.onmessage({data:{requestId:'request',result:42}});
  assert.equal(await request,42); assert.deepEqual(events,['changed']);
  context.client.close();assert.equal(sent.at(-1).action,'disconnect');
  port.onmessage({data:{event:'ended',roomId:'fixture'}}); assert.equal(events.length,1);
});


test('terminal UI notification invalidates pending loads and closes an open decision dialog', async () => {
  const source=await readFile(new URL('../app.mjs',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('function endTestView()'),source.indexOf('async function enterTest(client)'));
  let closed=0;
  const context=vm.createContext({loadSequence:7,state:{},actor:{},sessionId:'fixture',testPending:{},roster:[],dialog:{open:true,close(){this.open=false;}},testRoom:{close(){closed++;}},root:{innerHTML:''},button:()=>''});
  vm.runInContext(fn+'\nendTestView();',context);
  assert.equal(context.loadSequence,8); assert.equal(context.sessionId,null);
  assert.equal(context.state,null); assert.equal(context.testPending,null);
  assert.equal(context.dialog.open,false); assert.equal(closed,1);
  assert.match(context.root.innerHTML,/Test round ended/);
});
