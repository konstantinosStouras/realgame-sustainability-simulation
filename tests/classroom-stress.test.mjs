import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/main.mjs';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { createCloudHandler } from '../server/cloud-http.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';
import { assertInvariants, balance } from '../src/engine.mjs';
import { readBody } from '../server/read-body.mjs';
import { Readable } from 'node:stream';

const names = Array.from({ length: 12 }, (_, i) => `Synthetic team ${i + 1}`);
const students = Array.from({ length: 120 }, (_, i) => `synthetic-student-${i}`);
const verifyFirebase = async uid => ({ uid, name: uid, email_verified: true, instructor: uid === 'synthetic-teacher' });
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, call: async (path, token = 'synthetic-teacher', body) => {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  } };
}
const close = server => new Promise(resolve => server.close(resolve));

test('120 students across 12 competing teams: HTTP contention, duplicate retries, privacy and durable restart', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-classroom-stress-'));
  const path = join(directory, 'state.sqlite');
  let store = new Store(path);
  const { server } = createApp({ store, projectId: 'synthetic-only', verifyFirebase });
  const { call } = await listen(server);
  try {
    const created = await call('/api/sessions', undefined, { id: 'synthetic-classroom', companyNames: names });
    assert.equal(created.status, 201);
    const id = created.body.id, endpoint = `/api/sessions/${id}`, roster = await call(endpoint + '/roster');
    const joins = await Promise.all(students.map((student, i) => call('/api/join', student, { code: roster.body.invites[i % 12].code })));
    assert.ok(joins.every(r => r.status === 200));
    const members = await call(endpoint + '/roster');
    assert.equal(members.body.members.length, 121);
    for (let i = 1; i <= 12; i++) assert.equal(members.body.members.filter(m => m.companyId === `company-${i}`).length, 10);
    const requests = students.map((_, i) => ({ key: `student-deposit-${i}`, revision: 0, command: { type: 'deposit', amount: 10000, term: 24 } }));
    const burst = await Promise.all(students.map((student, i) => call(endpoint + '/command', student, requests[i])));
    assert.equal(burst.filter(r => r.status === 200).length, 1);
    assert.equal(burst.filter(r => r.status === 409).length, 119);
    // Each losing student reviews the latest revision before explicitly retrying.
    // Stale economic decisions must never be silently merged or committed twice.
    for (let i = 0; i < students.length; i++) {
      if (burst[i].status === 200) continue;
      const reviewed = await call(endpoint, students[i]);
      assert.equal(reviewed.body.state.company.id, `company-${i % 12 + 1}`);
      requests[i].revision = reviewed.body.state.revision;
      assert.equal((await call(endpoint + '/command', students[i], requests[i])).status, 200);
    }
    const retries = await Promise.all(students.flatMap((student, i) => [call(endpoint + '/command', student, requests[i]), call(endpoint + '/command', student, requests[i])]));
    assert.ok(retries.every(r => r.status === 200));
    let state = store.session(id);
    assert.equal(state.revision, 120);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 120);
    for (const company of state.companies) {
      assert.equal(company.deposits.length, 10);
      assert.equal(balance(company, 'deposits'), 100000);
      assert.equal(balance(company, 'cash'), 17900000);
    }
    assertInvariants(state);
    assert.equal((await call(endpoint + '/command', students[0], { ...requests[0], command: { ...requests[0].command, amount: 20000 } })).status, 409);
    assert.equal((await call(endpoint + '/command', students[0], { key: 'student-forged-clock', revision: 120, command: { type: 'step', hours: 24 } })).status, 403);
    assert.equal((await call(endpoint + '/roster', students[0])).status, 403);
    assert.equal((await call(endpoint + '/replay', students[0])).status, 403);
    assert.equal((await call(endpoint, 'synthetic-outsider')).status, 403);
    const privateText = 'Synthetic private team strategy';
    assert.equal((await call(endpoint + '/command', students[0], { key: 'private-team-strategy', revision: 120, command: { type: 'message', channel: 'team:company-1', text: privateText } })).status, 200);
    const views = await Promise.all(students.map(student => call(endpoint, student)));
    for (let i = 0; i < views.length; i++) {
      assert.equal(JSON.stringify(views[i].body).includes(privateText), i % 12 === 0);
      assert.ok(views[i].body.state.companies.every(c => !Object.hasOwn(c, 'cash')));
    }
    assert.equal(JSON.stringify((await call(endpoint + '/replay')).body).includes(privateText), false);
    assert.equal((await call(endpoint + '/command', undefined, { key: 'stress-day-close', revision: 121, command: { type: 'step', hours: 24 } })).status, 200);
    state = store.session(id);
    assert.equal(state.snapshots.length, 1);
    assert.ok(state.companies.every(c => c.deposits.every(d => d.maturedAt === 24)));
    assertInvariants(state);
    const persisted = JSON.stringify(state);
    await close(server); store.close(); store = new Store(path);
    assert.equal(JSON.stringify(store.session(id)), persisted);
    assert.equal(store.roster(store.user('firebase:synthetic-teacher'), id).members.length, 121);
  } finally {
    if (server.listening) await close(server);
    store.close();
    assert.ok(directory.startsWith(join(tmpdir(), 'studio-classroom-stress-')));
    await rm(directory, { recursive: true, force: true });
  }
});

test('120 cloud participants preserve exactly-once commits and shared due hours in transactional storage', { timeout: 60000 }, async () => {
  let now = 0;
  const store = new FirestoreStore(new MemoryFirestore(), { now: () => now });
  const teacher = await store.firebaseUser(await verifyFirebase('synthetic-teacher'));
  const session = await store.create(teacher, { companyNames: names });
  const invites = (await store.roster(teacher, session.id)).invites;
  const users = await Promise.all(students.map(async (name, i) => {
    const user = await store.firebaseUser(await verifyFirebase(name));
    await store.join(user, invites[i % 12].code); return user;
  }));
  const requests = users.map((_, i) => ({ key: `cloud-deposit-${i}`, revision: 0, command: { type: 'deposit', amount: 10000, term: 24 } }));
  const burst = await Promise.allSettled(users.map((user, i) => store.command(user, session.id, requests[i])));
  assert.equal(burst.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(burst.filter(r => r.status === 'rejected').every(r => r.reason.status === 409));
  for (let i = 0; i < users.length; i++) {
    if (burst[i].status === 'fulfilled') continue;
    requests[i].revision = (await store.view(users[i], session.id)).state.revision;
    await store.command(users[i], session.id, requests[i]);
  }
  await Promise.all(users.map((user, i) => store.command(user, session.id, requests[i])));
  assert.equal((await store.requests.get()).docs.length, 120);
  await store.command(teacher, session.id, { key: 'start-stress-clock', revision: 120, command: { type: 'clock', status: 'running', secondsPerHour: 1 } });
  now = 48000;
  await Promise.all([...users.map(user => store.view(user, session.id)), store.runDueClocks(), store.runDueClocks()]);
  const view = await store.view(teacher, session.id);
  assert.equal(view.state.hour, 48);
  assert.equal(view.state.revision, 169);
  assert.equal(view.state.snapshots.length, 2);
  const replay = await store.replay(teacher, session.id);
  assert.equal(replay.commands.filter(r => r.command.type === 'tick').length, 48);
  assert.equal(replay.commands.filter(r => r.command.type === 'deposit').length, 120);
  for (const user of users.slice(0, 12)) {
    const company = (await store.view(user, session.id)).state.company;
    assert.equal(company.deposits.length, 10);
    assert.ok(company.deposits.every(d => d.maturedAt === 24));
  }
});

test('local HTTP serves the complete browser import and worker graph', async () => {
  const store = new Store(':memory:'), { server } = createApp({ store, projectId: '' });
  const { origin } = await listen(server);
  try {
    const pending = ['/app.mjs', '/theme.mjs'], seen = new Set();
    while (pending.length) {
      const path = pending.pop(); if (seen.has(path)) continue; seen.add(path);
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, `Browser dependency must load: ${path}`);
      assert.match(response.headers.get('content-type'), /javascript/);
      const source = await response.text();
      for (const match of source.matchAll(/(?:from\s*|import\s*\(|new URL\s*\()(['"])(\.[^'"]+\.mjs(?:\?[^'"]*)?)\1/g)) {
        const dependency = new URL(match[2], origin + path);
        pending.push(dependency.pathname);
      }
    }
    assert.ok(seen.has('/src/session-updates.mjs'));
    assert.ok(seen.has('/src/test-worker.mjs'));
    assert.ok(seen.has('/src/test-classroom.mjs'));
  } finally { await close(server); store.close(); }
});

// Write a complete UTF-8 character across two separate HTTP chunks. This is a
// normal TCP boundary, independent of the browser/student's locale.
async function splitJsonPost(origin, path, body) {
  const bytes = Buffer.from(JSON.stringify(body)), marker = bytes.indexOf(Buffer.from('🌱')) + 2;
  assert.ok(marker > 2);
  return new Promise((resolve, reject) => {
    const request = http.request(origin + path, { method: 'POST', headers: { Authorization: 'Bearer synthetic-teacher', 'Content-Type': 'application/json' } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    request.on('error', reject);
    request.write(bytes.subarray(0, marker));
    setTimeout(() => request.end(bytes.subarray(marker)), 20);
  });
}

for (const cloud of [false, true]) test(`${cloud ? 'cloud' : 'local'} HTTP preserves multilingual text split across UTF-8 chunks`, async () => {
  const store = cloud ? new FirestoreStore(new MemoryFirestore()) : new Store(':memory:');
  const server = cloud
    ? http.createServer(createCloudHandler({ store, verifyFirebase, projectId: 'synthetic-only', allowedOrigins: [] }))
    : createApp({ store, verifyFirebase, projectId: 'synthetic-only' }).server;
  const { origin, call } = await listen(server);
  try {
    const name = 'Classroom 🌱 — Αθήνα 東京';
    const result = await splitJsonPost(origin, '/api/sessions', { name });
    assert.equal(result.status, 201);
    assert.equal((await call(`/api/sessions/${result.body.id}`)).body.state.name, name);
  } finally { await close(server); if (!cloud) store.close(); }
});

test('request size limits count actual bytes for streaming and pre-parsed cloud bodies', async () => {
  const bytes = Buffer.from('🌱'.repeat(4000));
  assert.equal(bytes.length, 16000);
  assert.deepEqual(await readBody(Readable.from([bytes.subarray(0, 3), bytes.subarray(3)])), bytes);
  assert.deepEqual(await readBody({ rawBody: bytes }), bytes);
  await assert.rejects(readBody(Readable.from([bytes, Buffer.from('x')])), { status: 413 });
  await assert.rejects(readBody({ rawBody: Buffer.concat([bytes, Buffer.from('x')]) }), { status: 413 });
});
