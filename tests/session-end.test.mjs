import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyCommand, advance, tick, assertInvariants } from '../src/engine.mjs';
const teacher = { id: 'teacher', name: 'Teacher', role: 'instructor' };
const student = { id: 'student', name: 'Student', role: 'student', companyId: 'company-1' };

test('ending a paused session now blocks new decisions and preserves pending obligations', () => {
  const s = createSession();
  applyCommand(s, student, { type: 'invest', kind: 'delivery' });
  advance(s, 24);
  applyCommand(s, teacher, { type: 'configure', endHour: 24 });
  assert.equal(s.status, 'completed');
  assert.throws(() => applyCommand(s, student, { type: 'purchase', supplierId: 'frame-circular', qty: 10 }), /Session completed/);
  const pending = s.events.find(e => e.type === 'investment');
  assert.equal(pending.status, 'pending');
  assert.equal(pending.at, 48);
  applyCommand(s, teacher, { type: 'message', channel: 'announcements', text: 'Discuss your results.' });
  applyCommand(s, teacher, { type: 'configure', endHour: 72 });
  assert.equal(s.status, 'paused');
  advance(s, 24);
  assert.equal(s.companies[0].investments[0].activeAt, 48);
  assertInvariants(s);
});

test('ending a running session now stops automatic ticks', () => {
  const s = createSession();
  applyCommand(s, teacher, { type: 'clock', status: 'running' });
  advance(s, 24);
  applyCommand(s, teacher, { type: 'configure', endHour: 24 });
  assert.equal(s.status, 'completed');
  tick(s);
  assert.equal(s.hour, 24);
  assertInvariants(s);
});
