import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { applyCommand, tick, canMessage } from '../src/engine.mjs';

function fixture() {
  const store = new Store(':memory:');
  const teacher = store.addUser('teacher', 'Teacher', 'synthetic-only-password', 'instructor');
  const student = store.addUser('student', 'Student', 'synthetic-only-password');
  const state = store.create(teacher);
  store.join(student, store.roster(teacher, state.id).invites[0].code);
  let request = 0;
  const send = (actor, command) => store.command(actor, state.id, { key: `replay-test-${++request}`, revision: store.session(state.id).revision, command });
  return { store, teacher, student, state, send };
}
function run(exported) {
  const replayed = structuredClone(exported.initial);
  for (const record of exported.commands) {
    if (record.command.type === 'tick') tick(replayed);
    else applyCommand(replayed, record.actor, record.command, record.realAt);
  }
  return replayed;
}
function privateNormalized(state, viewer) {
  const normalized = structuredClone(state);
  for (const m of normalized.messages) if (!canMessage(state, viewer, m.channel)) m.text = '[private message redacted]';
  for (const a of normalized.audit) if (a.command.type === 'message' && !canMessage(state, viewer, a.command.channel)) a.command.text = '[private message redacted]';
  return normalized;
}

test('assignment replay preserves revision and audit while keeping private chat redacted', () => {
  const { store, teacher, student, state, send } = fixture();
  try {
    send(student, { type: 'message', channel: 'team:company-1', text: 'PRIVATE-TEAM-ONE' });
    send(student, { type: 'message', channel: 'peer:company-1:company-2', text: 'PRIVATE-PEER' });
    store.assign(teacher, state.id, student.id, 'company-2');
    send(student, { type: 'message', channel: 'team:company-2', text: 'PRIVATE-TEAM-TWO' });
    send(student, { type: 'message', channel: 'teacher:company-2', text: 'Teacher-visible question' });
    send(teacher, { type: 'step', hours: 24 });
    store.assign(teacher, state.id, student.id, 'company-3');
    send(student, { type: 'purchase', supplierId: 'frame-circular', qty: 10 });
    const exported = store.replay(teacher, state.id);
    assert.equal(exported.complete, true);
    assert.equal(exported.missingAssignments, 0);
    assert.equal(exported.commands.filter(x => x.command.type === 'assignment').length, 2);
    assert.doesNotMatch(JSON.stringify(exported), /PRIVATE-TEAM-ONE|PRIVATE-PEER|PRIVATE-TEAM-TWO/);
    assert.match(JSON.stringify(exported), /Teacher-visible question/);
    const final = store.session(state.id);
    // Persistence uses JSON, which intentionally normalizes JavaScript -0 to 0.
    const replayed = JSON.parse(JSON.stringify(run(exported)));
    assert.equal(replayed.revision, final.revision);
    assert.deepEqual(replayed, privateNormalized(final, store.actor(teacher, state.id)));
    assert.equal(store.actor(student, state.id).companyId, 'company-3');
  } finally { store.close(); }
});

test('generic commands cannot append fake membership transitions', () => {
  const { store, teacher, student, state, send } = fixture();
  try {
    const prior = store.session(state.id);
    for (const actor of [teacher, student]) {
      assert.throws(() => send(actor, { type: 'assignment', userId: student.id, companyId: 'company-2' }), /assignment endpoint/);
    }
    assert.deepEqual(store.session(state.id), prior);
    assert.equal(store.actor(student, state.id).companyId, 'company-1');
    assert.throws(() => store.assign(student, state.id, student.id, 'company-2'), /Instructor/);
    assert.throws(() => store.assign(teacher, state.id, student.id, 'missing-company'), /Company not found/);
    assert.deepEqual(store.session(state.id), prior);
  } finally { store.close(); }
});

test('legacy unlogged assignments are labelled incomplete rather than exact replay', () => {
  const { store, teacher, student, state } = fixture();
  try {
    store.assign(teacher, state.id, student.id, 'company-2');
    // Simulate an old v1 database where assignment changed audit but had no log.
    store.db.prepare('DELETE FROM commands WHERE sessionId=?').run(state.id);
    const exported = store.replay(teacher, state.id);
    assert.equal(exported.complete, false);
    assert.equal(exported.missingAssignments, 1);
    assert.match(exported.note, /Incomplete replay/);
  } finally { store.close(); }
});
