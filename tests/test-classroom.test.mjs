import test from 'node:test';
import assert from 'node:assert/strict';
import { TestClassroom } from '../src/test-classroom.mjs';
import { testTemplate } from '../server/test-template.mjs';
import { createSession } from '../src/engine.mjs';
import { randomUUID } from 'node:crypto';

function fixture() {
  const source = createSession({name:'Assessed class'});
  source.messages.push({text:'PRIVATE MESSAGE'}); source.audit.push({actorName:'REAL STUDENT'});
  const template = testTemplate(createSession(),source);
  return {source,template,room:new TestClassroom(template,[{name:'Alpha',students:2},{name:'Beta',students:3},{name:'Gamma',students:1}],randomUUID)};
}
test('2/3/1 simulated students belong to exactly one company and never copy real student data', () => {
  const {room,template} = fixture();
  assert.equal(room.people.length,7);
  assert.deepEqual(room.state.companies.map(c => room.people.filter(p => p.companyId===c.id).length),[2,3,1]);
  assert.equal(room.state.hour,0);assert.equal(room.state.status,'paused');
  assert.doesNotMatch(JSON.stringify(template),/PRIVATE MESSAGE|REAL STUDENT/);
  assert.equal(room.state.messages.length,0);assert.equal(room.state.audit.length,0);
});
test('student tabs share company state, retain separate audit identities and cannot control the class', () => {
  const {room,source}=fixture(), sourceBefore=JSON.stringify(source);
  const [teacher,first,second,other]=room.people;
  const request={key:'shared-purchase',revision:0,command:{type:'purchase',supplierId:'frame-circular',qty:10}};
  const response=room.command(first.key,request);
  assert.deepEqual(room.command(first.key,request),response);
  assert.equal(room.view(second.key).state.company.purchases.length,1);
  assert.equal(room.view(other.key).state.company.purchases.length,0);
  assert.equal(room.view(teacher.key).state.audit.at(-1).actorId,first.id);
  assert.equal(JSON.stringify(source),sourceBefore);
  assert.throws(()=>room.command(second.key,{key:'stale-request',revision:0,command:request.command}),e=>e.status===409);
  assert.throws(()=>room.command(first.key,{key:'forged-instructor',revision:1,command:{type:'step',hours:1}}),e=>e.status===403);
  assert.throws(()=>room.roster(first.key),e=>e.status===403);
  assert.throws(()=>room.view('invalid-token'),e=>e.status===403);
});
test('simulated students keep message identity and team privacy; instructor sees economic changes', () => {
  const {room}=fixture(),[teacher,first,second,other]=room.people;
  room.command(first.key,{key:'message-one',revision:0,command:{type:'message',channel:'team:company-1',text:'Test message'}});
  assert.equal(room.view(second.key).state.messages[0].senderId,first.id);
  assert.equal(room.view(other.key).state.messages.length,0);
  assert.equal(room.view(teacher.key).state.messages.length,0);
});
test('shared test clock advances once and closure freezes student decisions', () => {
  const {room}=fixture(),[teacher,student]=room.people;
  room.command(teacher.key,{key:'start-clock',revision:0,command:{type:'clock',status:'running'}},0);
  room.advance(8000);room.advance(8000);assert.equal(room.state.hour,2);
  room.command(teacher.key,{key:'close-clock',revision:room.state.revision,command:{type:'closeSession'}},8000);
  room.advance(12000);assert.equal(room.state.hour,2);
  assert.throws(()=>room.command(student.key,{key:'closed-purchase',revision:room.state.revision,command:{type:'purchase',supplierId:'frame-circular',qty:10}}),/completed/);
});
test('invalid company allocations and failed compound decisions do not partially mutate a test round', () => {
  assert.throws(()=>new TestClassroom({},[{name:'Bad',students:0}],randomUUID),/students/);
  const {room}=fixture(),before=JSON.stringify(room.state);
  assert.throws(()=>room.command(room.people[0].key,{key:'invalid-config',revision:0,command:{type:'configure',name:'Changed',endHour:-1}}));
  assert.equal(JSON.stringify(room.state),before);
});
