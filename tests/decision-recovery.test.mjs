import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { FirestoreStore } from '../server/firestore-store.mjs';
import { MemoryFirestore } from './helpers/memory-firestore.mjs';
import { createCloudHandler } from '../server/cloud-http.mjs';
import { assertInvariants } from '../src/engine.mjs';

async function fixture({ teams = 3, students = 12, sameTeam = false } = {}) {
  const db = new MemoryFirestore(), store = new FirestoreStore(db, { now: () => 0 });
  const teacher = await store.firebaseUser({ uid: 'teacher', name: 'Synthetic teacher', email_verified: true, instructor: true });
  const { id } = await store.create(teacher, { companyNames: Array.from({ length: teams }, (_, i) => `Synthetic team ${i + 1}`) });
  const roster = await store.roster(teacher, id), users = [];
  for (let i = 0; i < students; i++) {
    const user = await store.firebaseUser({ uid: `student-${i}`, name: `Synthetic student ${i}`, email_verified: true });
    await store.join(user, roster.invites[sameTeam ? 0 : i % teams].code); users.push(user);
  }
  return { db, store, teacher, users, id };
}
const attempt = async promise => { try { return { status: 200, value: await promise }; } catch (error) { return { status: error.status, error: error.message }; } };

test('12 same-team financial decisions serialize, reviewed losers cannot exceed the shared loan limit', async () => {
  const f = await fixture({ sameTeam: true });
  const command = { type: 'loan', amount: 10000000, term: 168 };
  const requests = f.users.map((_, i) => ({ key: `competing-loan-${i}`, revision: 0, command }));
  const results = await Promise.all(f.users.map((user, i) => attempt(f.store.command(user, f.id, requests[i]))));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 11);
  for (let i = 0; i < results.length; i++) if (results[i].status === 409) {
    const retry = await attempt(f.store.command(f.users[i], f.id, { ...requests[i], revision: 1 }));
    assert.equal(retry.status, 400); assert.match(retry.error, /loan limit/i);
  }
  const current = (await f.store.readViewSnapshot(f.teacher, f.id)).state;
  assert.equal(current.revision, 1); assert.equal(current.companies[0].loans.length, 1);
  assert.equal(current.companies[0].loans[0].amount, 10000000);
  assert.equal((await f.store.requests.get()).docs.length, 1); assertInvariants(current);
});

test('12 competing teams cannot oversell shared supplier stock after reviewing stale decisions', async () => {
  const f = await fixture({ teams: 12 });
  await f.store.command(f.teacher, f.id, { key: 'limit-shared-supplier', revision: 0, command: { type: 'catalog', collection: 'suppliers', id: 'frame-circular', patch: { stock: 100 } } });
  const requests = f.users.map((_, i) => ({ key: `competing-purchase-${i}`, revision: 1, command: { type: 'purchase', supplierId: 'frame-circular', qty: 60 } }));
  const results = await Promise.all(f.users.map((user, i) => attempt(f.store.command(user, f.id, requests[i]))));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 11);
  for (let i = 0; i < results.length; i++) if (results[i].status === 409) {
    const retry = await attempt(f.store.command(f.users[i], f.id, { ...requests[i], revision: 2 }));
    assert.equal(retry.status, 400); assert.match(retry.error, /only 40 units/);
  }
  const state = (await f.store.readViewSnapshot(f.teacher, f.id)).state;
  assert.equal(state.catalog.suppliers.find(s => s.id === 'frame-circular').stock, 40);
  assert.equal(state.companies.flatMap(c => c.purchases).reduce((sum, p) => sum + p.qty, 0), 60);
  assert.equal(state.events.filter(e => e.type === 'purchaseReceipt').length, 1);
  assert.equal(state.revision, 2); assertInvariants(state);
});

test('same request key remains scoped to its author and cannot mutate payload or move an accepted action after reassignment', async () => {
  const f = await fixture({ students: 2 });
  const request = { key: 'shared-client-key', revision: 0, command: { type: 'deposit', amount: 10000, term: 24 } };
  const receipt = await f.store.command(f.users[0], f.id, request);
  const other = await f.store.command(f.users[1], f.id, { ...request, revision: 1 });
  assert.equal(other.revision, 2);
  await f.store.assign(f.teacher, f.id, f.users[0].id, 'company-3');
  assert.deepEqual(await f.store.command(f.users[0], f.id, request), receipt);
  await assert.rejects(f.store.command(f.users[0], f.id, { ...request, revision: 3, command: { ...request.command, amount: 20000 } }), { status: 409 });
  const state = (await f.store.readViewSnapshot(f.teacher, f.id)).state;
  assert.deepEqual(state.companies.map(c => c.deposits.length), [1, 1, 0]);
  assert.equal(state.revision, 3); assertInvariants(state);
});

test('receipt retries recheck session access and membership instead of returning cached authorization', async () => {
  const f = await fixture({ students: 1 }), user = f.users[0];
  const request = { key: 'retry-after-revocation', revision: 0, command: { type: 'deposit', amount: 10000, term: 24 } };
  const receipt = await f.store.command(user, f.id, request);
  await f.store.command(f.teacher, f.id, { key: 'close-student-access', revision: 1, command: { type: 'configure', studentAccess: false } });
  await assert.rejects(f.store.command(user, f.id, request), { status: 403 });
  await f.store.command(f.teacher, f.id, { key: 'restore-student-access', revision: 2, command: { type: 'configure', studentAccess: true } });
  assert.deepEqual(await f.store.command(user, f.id, request), receipt);
  await f.db.runTransaction(async tx => tx.delete(f.store.memberRef(f.id, user.id)));
  await assert.rejects(f.store.command(user, f.id, request), { status: 403 });
  assert.equal((await f.store.readViewSnapshot(f.teacher, f.id)).state.companies[0].deposits.length, 1);
});

test('committed HTTP decision with a dropped reply retries once after refresh and still verifies authentication', async () => {
  const f = await fixture({ students: 1 }); let dropReply = true, verifies = 0, allowToken = true;
  const handler = createCloudHandler({ store: f.store, projectId: 'synthetic', allowedOrigins: [], verifyFirebase: async token => {
    verifies++; if (!allowToken || token !== 'student-0') throw Object.assign(new Error('Synthetic revoked token'), { status: 401 });
    return { uid: token, name: 'Synthetic student 0', email_verified: true };
  } });
  const server = http.createServer((req, res) => {
    if (req.url.endsWith('/command') && dropReply) {
      dropReply = false;
      // The handler only sends after the transactional decision has committed.
      // Destroy the actual socket before response bytes reach the client.
      res.end = () => { res.destroy(); return res; };
    }
    void handler(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, agent = new http.Agent({ keepAlive: true, maxSockets: 20 });
  const call = (path, body) => new Promise((resolve, reject) => {
    const req = http.request(origin + path, { agent, method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer student-0', 'Content-Type': 'application/json' } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    const path = `/api/sessions/${f.id}`, request = { key: 'dropped-reply-deposit', revision: 0, command: { type: 'deposit', amount: 10000, term: 24 } };
    await assert.rejects(call(path + '/command', request), { code: 'ECONNRESET' });
    const refreshed = await call(path); assert.equal(refreshed.status, 200); assert.equal(refreshed.body.state.revision, 1);
    const retries = await Promise.all(Array.from({ length: 20 }, () => call(path + '/command', request)));
    assert.ok(retries.every(r => r.status === 200 && r.body.revision === 1));
    assert.equal((await f.store.view(f.users[0], f.id)).state.company.deposits.length, 1);
    assert.equal((await f.store.requests.get()).docs.length, 1);
    allowToken = false;
    assert.equal((await call(path + '/command', request)).status, 401);
    assert.equal(verifies, 23, 'every retry and refresh verifies its current token');
  } finally { agent.destroy(); await new Promise(resolve => server.close(resolve)); }
});
