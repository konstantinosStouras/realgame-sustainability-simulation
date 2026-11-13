import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { createCloudHandler } from '../server/cloud-http.mjs';

test('large authenticated views negotiate gzip without changing private content or authorization', async () => {
  let projections = 0;
  const state = { ledger: Array.from({ length: 200 }, (_, i) => ({ id: i, description: 'Synthetic financial history', amount: i * 123 })) };
  const store = {
    firebaseUser: async actor => actor,
    viewJSON: async actor => { projections++; return JSON.stringify({ actor, state }); }
  };
  const server = http.createServer(createCloudHandler({ store, projectId: 'test', allowedOrigins: ['https://classroom.example'], verifyFirebase: async token => {
    if (!['alice', 'bob'].includes(token)) throw Object.assign(new Error('Invalid token'), { status: 401 });
    return { id: token, role: 'student', companyId: token };
  } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = (encoding, token = 'alice') => new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${server.address().port}/api/sessions/test`, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://classroom.example', ...(encoding === undefined ? {} : { 'Accept-Encoding': encoding }) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  try {
    for (const encoding of ['gzip', 'br, gzip;q=0.5', '*;q=1', 'GZip']) {
      const r = await request(encoding);
      assert.equal(r.status, 200); assert.equal(r.headers['content-encoding'], 'gzip');
      const decoded = gunzipSync(r.bytes);
      assert.deepEqual(JSON.parse(decoded), { actor: { id: 'alice', role: 'student', companyId: 'alice' }, state });
      assert.ok(r.bytes.length < decoded.length / 2);
      assert.equal(r.headers.vary, 'Origin, Accept-Encoding');
      assert.equal(r.headers['cache-control'], 'no-store');
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
    }
    for (const encoding of [undefined, 'identity', 'gzip;q=0', '*;q=1, gzip;q=0', 'gzip;q=invalid', 'gzip;q=1.5']) {
      const r = await request(encoding, 'bob');
      assert.equal(r.status, 200); assert.equal(r.headers['content-encoding'], undefined);
      assert.equal(JSON.parse(r.bytes).actor.id, 'bob'); assert.deepEqual(JSON.parse(r.bytes).state, state);
    }
    const before = projections, denied = await request('gzip', 'invalid');
    assert.equal(denied.status, 401); assert.equal(projections, before);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
