import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/main.mjs';
import { applyCommand, tick } from '../src/engine.mjs';
import * as engineForView from '../src/engine.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const password = 'synthetic-test-passphrase';
function fixture(path = ':memory:') { const store = new Store(path), t = store.addUser('teacher', 'Teacher', password, 'instructor'), s = store.create(t), u = store.addUser('student', 'Student', password); const code = store.roster(t, s.id).invites[0].code; store.join(u, code); return { store, t, s, u }; }
test('duplicate retries commit once; conflicting reuse and stale decisions are rejected', () => {
  const { store, s, u } = fixture();
  const request = { key: 'request-123', revision: 0, command: { type: 'purchase', supplierId: 'frame-circular', qty: 10 } };
  const first = store.command(u, s.id, request); assert.deepEqual(store.command(u, s.id, request), first);
  assert.equal(store.session(s.id).companies[0].purchases.length, 1);
  assert.throws(() => store.command(u, s.id, { ...request, command: { ...request.command, qty: 11 } }), /different decision/);
  assert.throws(() => store.command(u, s.id, { ...request, key: 'request-456' }), /session changed/); store.close();
});
test('invalid compound updates roll back the entire SQLite transaction', () => {
  const { store, t, s } = fixture();
  assert.throws(() => store.command(t, s.id, { key: 'request-123', revision: 0, command: { type: 'configure', name: 'Should not save', endHour: -1 } }));
  assert.equal(store.session(s.id).name, s.name); assert.equal(store.session(s.id).revision, 0); store.close();
});
test('persistence, tokens, scoped membership and deterministic command export survive restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-test-')), path = join(dir, 'state.sqlite');
  try {
    let { store, t, s, u } = fixture(path); const login = store.login('student', password);
    store.command(t, s.id, { key: 'advance-1', revision: 0, command: { type: 'step', hours: 24 } });
    const replay = store.replay(t, s.id); for (const record of replay.commands) record.command.type === 'tick' ? tick(replay.initial) : applyCommand(replay.initial, record.actor, record.command, record.realAt);
    assert.equal(JSON.stringify(replay.initial), JSON.stringify(store.session(s.id)));
    const other = store.addUser('outsider', 'Outsider', password); assert.throws(() => store.actor(other, s.id), /not a member/); store.close();
    store = new Store(path); assert.equal(store.session(s.id).hour, 24); assert.equal(store.authenticate(login.token).id, u.id); store.logout(login.token); assert.throws(() => store.authenticate(login.token), /Sign in/); store.close();
  } finally { assert.ok(dir.startsWith(join(tmpdir(), 'studio-test-'))); rmSync(dir, { recursive: true, force: true }); }
});
test('HTTP roles, simultaneous submissions, shared messages and private-file isolation', async () => {
  const { store, t, s, u } = fixture(), { server } = createApp({ store, projectId: '' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`, ut = store.issueToken(u.id).token, tt = store.issueToken(t.id).token;
  const post = (path, body, token = ut) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(url + '/private/realgame-study-2026-11-12/index.html')).status, 404);
    assert.equal((await fetch(url + '/.data/simulation.sqlite')).status, 404);
    assert.equal((await fetch(url + `/api/sessions/${s.id}`)).status, 401);
    assert.equal((await post(`/api/sessions/${s.id}/command`, { key: 'student-clock', revision: 0, command: { type: 'step', hours: 1 } })).status, 403);
    const req = { key: 'parallel-key', revision: 0, command: { type: 'purchase', supplierId: 'frame-circular', qty: 10 } };
    const responses = await Promise.all([post(`/api/sessions/${s.id}/command`, req), post(`/api/sessions/${s.id}/command`, req)]);
    assert.ok(responses.every(r => r.status === 200)); assert.equal(store.session(s.id).companies[0].purchases.length, 1);
    const revision = store.session(s.id).revision;
    const competing = await Promise.all([post(`/api/sessions/${s.id}/command`, { ...req, key: 'new-key-1', revision }), post(`/api/sessions/${s.id}/command`, { ...req, key: 'new-key-2', revision })]);
    assert.deepEqual(competing.map(x => x.status).sort(), [200, 409]);
    assert.equal((await post(`/api/sessions/${s.id}/command`, { key: 'announcement-1', revision: store.session(s.id).revision, command: { type: 'message', channel: 'announcements', text: 'Review your stock.' } }, tt)).status, 200);
    const v = await (await fetch(url + `/api/sessions/${s.id}`, { headers: { Authorization: `Bearer ${ut}` } })).json(); assert.equal(v.state.messages[0].text, 'Review your stock.');
    const spoof = await fetch(url + '/api/health', { headers: { Origin: 'https://malicious.example' } }); assert.equal(spoof.status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
test('Firebase identities cannot request their own role and local login is disabled', async () => {
  const store = new Store(':memory:');
  const claims = { student: { uid: 'google-student', name: 'Google Student', email_verified: true }, teacher: { uid: 'google-teacher', name: 'Google Teacher', email_verified: true, instructor: true }, unverified: { uid: 'not-verified', email_verified: false } };
  const { server } = createApp({ store, projectId: 'test-project', verifyFirebase: async token => { if (!claims[token]) throw Object.assign(new Error('Invalid Firebase token'), { status: 401 }); return claims[token]; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token, body) => fetch(url + '/api' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await call('/login', 'student', { username: 'anything', password })).status, 403);
    assert.equal((await call('/me', 'invalid')).status, 401);
    assert.equal((await call('/me', 'unverified')).status, 403);
    assert.equal((await (await call('/me', 'student')).json()).user.role, 'student');
    assert.equal((await call('/sessions', 'student', { name: 'Try elevated role', role: 'instructor' })).status, 403);
    const created = await (await call('/sessions', 'teacher', { name: 'Firebase class' })).json();
    const roster = await (await call(`/sessions/${created.id}/roster`, 'teacher')).json();
    assert.equal((await call('/join', 'student', { code: roster.invites[0].code, role: 'instructor' })).status, 200);
    const view = await (await call(`/sessions/${created.id}`, 'student')).json(); assert.equal(view.actor.role, 'student'); assert.equal(view.state.company.id, 'company-1');
    claims.teacher.instructor = false;
    assert.equal((await call(`/sessions/${created.id}/roster`, 'teacher')).status, 403);
  } finally { await new Promise(r => server.close(r)); store.close(); }
});
test('private messages are absent from instructor replay exports', () => {
  const { store, t, s, u } = fixture();
  store.command(u, s.id, { key: 'private-team-msg', revision: 0, command: { type: 'message', channel: 'team:company-1', text: 'private content' } });
  const exported = JSON.stringify(store.replay(t, s.id)); assert.equal(exported.includes('private content'), false); assert.ok(exported.includes('[private message redacted]')); store.close();
});
test('team and peer messages reach their participants but not another company', () => {
  const { store, t, s, u } = fixture();
  const second = store.addUser('teammate', 'Teammate', password), peer = store.addUser('peer-user', 'Peer', password), other = store.addUser('other-user', 'Other', password);
  const invites = store.roster(t, s.id).invites;
  store.join(second, invites[0].code); store.join(peer, invites[1].code); store.join(other, invites[2].code);
  store.command(u, s.id, { key: 'team-roundtrip', revision: 0, command: { type: 'message', channel: 'team:company-1', text: 'Internal team plan' } });
  store.command(u, s.id, { key: 'peer-roundtrip', revision: 1, command: { type: 'message', channel: 'peer:company-1:company-2', text: 'Peer question' } });
  const { publicView } = engineForView;
  const view = who => publicView(store.session(s.id), store.actor(who, s.id));
  assert.equal(view(second).messages.length, 2); assert.equal(view(peer).messages.length, 1); assert.equal(view(other).messages.length, 0); assert.equal(view(t).messages.length, 0);
  store.assign(t, s.id, second.id, 'company-3'); assert.equal(view(second).messages.length, 0); store.close();
});
