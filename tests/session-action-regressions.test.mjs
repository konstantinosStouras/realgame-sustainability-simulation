import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
const settings = vm.runInNewContext(source.slice(source.indexOf('function sessionSettingsCommand('), source.indexOf('function closeMobileMenu(')) + '\nsessionSettingsCommand');
const form = days => new Map([['days', String(days)], ['name','Renamed'], ['studentAccess','on'], ['speed','4']]);
test('unchanged closed duration is omitted, including hour zero and partial days', () => {
  for (const hour of [0,1,23,24,103,4319,4320]) {
    const result = settings({endHour:hour,hour}, form(hour/24));
    assert.equal(Object.hasOwn(result,'endHour'),false);
    assert.equal(result.name,'Renamed');
  }
});
test('duration extensions use integer hours and enforce limits', () => {
  assert.equal(settings({endHour:103,hour:103},form(5)).endHour,120);
  assert.equal(settings({endHour:0,hour:0},form(1)).endHour,24);
  for (const days of ['NaN',Infinity,0.5,4,181,5.001]) {
    assert.throws(()=>settings({endHour:103,hour:103},form(days)));
  }
});
test('bulk retry skips successes and retries only pending operations', async () => {
  const calls = []; let submit, failOnce=true;
  const context = vm.createContext({health:{sessionLifecycle:true},
    sessions:[{id:'a',name:'A',status:'paused'},{id:'b',name:'B',status:'paused'},{id:'c',name:'C',status:'completed'}],
    modal:(title,body,callback)=>{submit=callback;}, esc:x=>x, field:()=>'', enter:async()=>{}, toast:()=>{},
    lifecycleRequest:async id=>{calls.push(id); if(id==='b' && failOnce){failOnce=false;throw new Error('temporary failure');}}
  });
  const start=source.indexOf("  if (['session-close', 'session-delete', 'sessions-delete'].includes(name)) {");
  const end=source.indexOf("  if (name === 'session-export')",start);
  vm.runInContext('async function run(name,id){'+source.slice(start,end)+'}',context);
  await vm.runInContext("run('sessions-delete')",context);
  await assert.rejects(submit(new Map([['confirmation','NO']])),/Type DELETE/); assert.deepEqual(calls,[]);
  await assert.rejects(submit(new Map([['confirmation','DELETE']])),/1 of 2 sessions updated/);
  await submit(new Map([['confirmation','DELETE']]));
  assert.deepEqual(calls,['a','b','b']);
});
test('Close copy describes student access loss and instructor retention', () => {
  const hint=source.split('\n').find(line=>line.trim().startsWith("'session-close':"));
  assert.match(hint,/students can no longer open the session/);
  assert.match(hint,/Instructors retain access to results/);
});
