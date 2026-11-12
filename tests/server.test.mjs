import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/main.mjs';
import { applyCommand, tick } from '../src/engine.mjs';
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
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('HTTP roles, simultaneous submissions, shared messages and private-file isolation', async () => {
  const { store, t, s, u } = fixture(), { server } = createApp({ store });
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
