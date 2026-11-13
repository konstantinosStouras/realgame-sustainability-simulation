import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { applyCommand } from '../src/engine.mjs';
const source = readFileSync(new URL('../app.mjs', import.meta.url),'utf8');
const settings = vm.runInNewContext(source.slice(source.indexOf('function sessionSettingsCommand('),source.indexOf('function closeMobileMenu('))+'\nsessionSettingsCommand');
// Plain in-memory command inputs only: no stores, session/account creation, network, or downloads.
const form = (speed='12') => new Map([['days',String(103/24)],['name','Updated'],['speed',speed],['studentAccess','on']]);
const input = status => ({status,hour:103,endHour:status==='completed'?103:240,secondsPerHour:4,companies:[],events:[],audit:[],revision:0,sequence:0});
test('one settings command saves speed and name while preserving closed state',()=>{
 const data=input('completed'); const command=settings(data,form());
 assert.equal(command.secondsPerHour,12); assert.equal(Object.hasOwn(command,'endHour'),false);
 applyCommand(data,{id:'mock',role:'instructor',name:'Mock'},command);
 assert.equal(data.name,'Updated');assert.equal(data.secondsPerHour,12);assert.equal(data.status,'completed');assert.equal(data.endHour,103);assert.equal(data.revision,1);assert.equal(data.audit.length,1);
});
test('configuration preserves running and paused clock status',()=>{
 for(const status of ['running','paused']) {
  const data=input(status);
  applyCommand(data,{id:'mock',role:'instructor',name:'Mock'},{type:'configure',secondsPerHour:9});
  assert.equal(data.status,status);assert.equal(data.secondsPerHour,9);
 }
});
test('invalid speeds and unauthorized commands are rejected',()=>{
 for(const speed of ['0','121','1.5','NaN','']) assert.throws(()=>settings(input('completed'),form(speed)),/clock speed/);
 for(const speed of [0,121,1.5,NaN]) assert.throws(()=>applyCommand(input('completed'),{role:'instructor'},{type:'configure',secondsPerHour:speed}));
 assert.throws(()=>applyCommand(input('paused'),{role:'student'},{type:'configure',secondsPerHour:9}),/Instructor/);
});
test('Settings submission invokes one command; retry repeats the same payload',async()=>{
 const line=source.split('\n').find(l=>l.includes("if (name === 'settings')"));
 const callback=line.slice(line.indexOf('async f =>'),line.lastIndexOf(", 'Save settings'"));
 const calls=[], context={solo:null,testRoom:null,health:{atomicSessionSettings:true},state:input('completed'),sessionSettingsCommand:settings,command:async c=>{calls.push(JSON.stringify(c));if(calls.length===1)throw new Error('response lost');}};
 const submit=vm.runInNewContext('('+callback+')',context);
 await assert.rejects(submit(form()),/response lost/);await submit(form());
 assert.equal(calls.length,2);assert.equal(calls[0],calls[1]);
 context.health.atomicSessionSettings=false;
 await assert.rejects(submit(form()),/backend needs the Settings update/);assert.equal(calls.length,2);
});
