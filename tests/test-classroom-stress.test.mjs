import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TestClassroom } from '../src/test-classroom.mjs';
import { assertInvariants, createSession } from '../src/engine.mjs';
import { testTemplate } from '../server/test-template.mjs';

function classroom() {
  const initial = createSession();
  return new TestClassroom(testTemplate(initial, initial), Array.from({length:12}, (_, i) => ({name:`Stress company ${i + 1}`, students:5})), randomUUID);
}
function request(room, command, key = randomUUID()) { return {key, revision:room.state.revision, command}; }

test('60 students across 12 teams safely retry stale decisions and compete for limited supplier stock', () => {
  const room = classroom(), [teacher, ...students] = room.people;
  assert.equal(students.length, 60);
  for (let round = 0; round < 3; round++) {
    const requests = students.map(person => request(room, {type:'message', channel:`team:${person.companyId}`, text:`Round ${round}: ${person.name}`}));
    students.forEach((person, i) => {
      const decision = requests[i];
      if (i) assert.throws(() => room.command(person.key, decision), error => error.status === 409);
      decision.revision = room.state.revision;
      const result = room.command(person.key, decision), revision = room.state.revision;
      assert.deepEqual(room.command(person.key, decision), result);
      assert.equal(room.state.revision, revision);
    });
  }
  assert.equal(room.state.messages.length, 180);
  for (const person of students) {
    const view = room.view(person.key).state;
    assert.equal(view.messages.length, 15);
    assert.ok(view.messages.every(message => message.companyId === person.companyId));
  }
  assert.equal(room.view(teacher.key).state.messages.length, 0);
  room.command(teacher.key, request(room, {type:'catalog', collection:'suppliers', id:'frame-circular', patch:{stock:10}}));
  const purchases = students.map(() => request(room, {type:'purchase', supplierId:'frame-circular', qty:10}));
  room.command(students[0].key, purchases[0]);
  for (let i = 1; i < students.length; i++) {
    assert.throws(() => room.command(students[i].key, purchases[i]), error => error.status === 409);
    purchases[i].revision = room.state.revision;
    assert.throws(() => room.command(students[i].key, purchases[i]), /only 0 units/);
  }
  assert.equal(room.state.companies.reduce((n, company) => n + company.purchases.length, 0), 1);
  assert.equal(room.state.catalog.suppliers.find(s => s.id === 'frame-circular').stock, 0);
  assertInvariants(room.state);
});

test('closing student access revokes existing test views and decisions until reopened', () => {
  const room = classroom(), [teacher, student] = room.people;
  const purchase = request(room, {type:'purchase', supplierId:'frame-circular', qty:10});
  room.command(student.key, purchase);
  room.command(teacher.key, request(room, {type:'configure', studentAccess:false}));
  const before = JSON.stringify(room.state);
  assert.throws(() => room.view(student.key), error => error.status === 403);
  assert.throws(() => room.command(student.key, request(room, {type:'purchase', supplierId:'frame-circular', qty:10})), error => error.status === 403);
  assert.throws(() => room.command(student.key, purchase), error => error.status === 403);
  assert.equal(JSON.stringify(room.state), before);
  assert.equal(room.view(teacher.key).state.studentAccess, false);
  room.command(teacher.key, request(room, {type:'configure', studentAccess:true}));
  assert.equal(room.view(student.key).state.company.purchases.length, 1);
  room.command(student.key, request(room, {type:'purchase', supplierId:'frame-circular', qty:10}));
  assert.equal(room.view(student.key).state.company.purchases.length, 2);
});

test('completed test classrooms retain student reports, reject decisions, and reopen after extension', () => {
  const room = classroom(), [teacher, student] = room.people;
  room.command(teacher.key, request(room, {type:'closeSession'}));
  assert.equal(room.view(student.key).state.status,'completed');
  assert.throws(() => room.command(student.key, request(room, {type:'message', channel:`team:${student.companyId}`, text:'Closed'})), error => error.status === 409);
  room.command(teacher.key, request(room, {type:'configure', endHour:48}));
  assert.equal(room.view(student.key).state.status, 'paused');
});

test('running test speed changes schedule the next hour at the new speed', () => {
  const room = classroom(), teacher = room.people[0];
  room.command(teacher.key, request(room, {type:'clock', status:'running', secondsPerHour:120}), 0);
  room.command(teacher.key, request(room, {type:'configure', secondsPerHour:1}), 1000);
  room.advance(1999); assert.equal(room.state.hour, 0);
  room.advance(2000); assert.equal(room.state.hour, 1);
  room.command(teacher.key, request(room, {type:'configure', secondsPerHour:120}), 2500);
  room.advance(3000); assert.equal(room.state.hour, 1);
  room.advance(122500); assert.equal(room.state.hour, 2);
  room.advance(122500); assert.equal(room.state.hour, 2);
});

test('unrelated settings keep an already scheduled test hour intact', () => {
  const room = classroom(), teacher = room.people[0];
  room.command(teacher.key, request(room, {type:'clock', status:'running', secondsPerHour:4}), 0);
  room.command(teacher.key, request(room, {type:'configure', name:'Renamed classroom', secondsPerHour:4}), 3000);
  room.advance(4000); assert.equal(room.state.hour, 1);
});
