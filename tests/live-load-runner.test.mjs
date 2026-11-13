import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const source = readFileSync(new URL('../scripts/live-classroom-load.mjs', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const limit = vm.runInNewContext(source.slice(source.indexOf('  const limit ='), source.indexOf('  async function identity(')) + '\nlimit;');

test('failed identity worker stops new creation and drains every started worker before cleanup', async () => {
  const gates = Array.from({ length: 3 }, deferred), started = [], finished = [];
  let cleaned = false;
  const provisioning = (async () => {
    try {
      await limit(Array.from({ length: 121 }, (_, i) => i), 3, async i => {
        started.push(i); await gates[i].promise; finished.push(i);
      });
    } finally { cleaned = true; }
  })();
  const rejection = assert.rejects(provisioning, /Synthetic sign-in failed/);
  assert.deepEqual(started, [0, 1, 2]);
  gates[0].reject(new Error('Synthetic sign-in failed'));
  await flush();
  assert.equal(cleaned, false, 'cleanup must wait for other account creations');
  assert.deepEqual(started, [0, 1, 2], 'no additional identity may start after the failure');
  gates[2].resolve(); await flush(); assert.equal(cleaned, false);
  gates[1].resolve(); await rejection;
  assert.equal(cleaned, true); assert.deepEqual(finished, [2, 1]); assert.deepEqual(started, [0, 1, 2]);
});

function transport({ refreshIdentity = async () => {}, fetch = async () => { throw new Error('Unexpected auth call'); }, actualRefresh = false } = {}) {
  const requests = [], samples = []; let now = 0;
  const https = { request(url, options, callback) {
    const request = new EventEmitter();
    request.end = body => { request.body = body; request.finished = true; request.emit('finish'); };
    request.destroy = error => { request.destroyed = true; request.emit('error', error); request.emit('close'); };
    const abort = () => request.destroy(Object.assign(new Error('Request aborted'), { code: 'ABORT_ERR' }));
    options.signal.addEventListener('abort', abort, { once: true });
    request.on('close', () => options.signal.removeEventListener('abort', abort));
    requests.push({ url, options, callback, request }); return request;
  } };
  const context = vm.createContext({ assert, https, agent: {}, base: 'https://synthetic.invalid/api', apiKey: 'test-key', samples,
    refreshIdentity, fetch, Date, URLSearchParams, Buffer, gunzipSync, AbortSignal, setTimeout, clearTimeout, performance: { now: () => now } });
  if (actualRefresh) vm.runInContext(source.slice(source.indexOf('  async function refreshIdentity('), source.indexOf('  async function call(')), context);
  vm.runInContext(source.slice(source.indexOf('  async function call('), source.indexOf('  const requireOk')), context);
  return { samples, requests, call: context.call, time: value => { now = value; },
    reply(index, status, value) {
      const { callback, request } = requests[index], response = new EventEmitter();
      response.statusCode = status; response.headers = {}; callback(response);
      response.emit('data', Buffer.from(JSON.stringify(value))); response.emit('end'); request.emit('close');
    } };
}

test('token-refresh failure is measured and does not reject a wave before other requests drain', async () => {
  const token = deferred(), h = transport({ refreshIdentity: () => token.promise }); let cleaned = false;
  const wave = (async () => {
    try { return await Promise.all([h.call('refresh-failed', '/session', { expiresAt: 0 }), h.call('still-in-flight', '/session', { token: 'synthetic' })]); }
    finally { cleaned = true; }
  })();
  h.time(23); token.reject(new Error('Synthetic token refresh failed')); await flush();
  assert.equal(cleaned, false); assert.equal(h.requests.length, 1);
  assert.equal(h.samples[0].status, 0); assert.equal(h.samples[0].ms, 23);
  assert.match(h.samples[0].error, /token refresh failed/); assert.equal(h.samples[0].injectedFault, undefined);
  h.reply(0, 200, { ok: true }); const results = await wave;
  assert.equal(cleaned, true); assert.deepEqual(results.map(result => result.status), [0, 200]);
});

test('concurrent requests share one identity refresh and use its fresh token', async () => {
  const token = deferred(); let refreshes = 0;
  const h = transport({ actualRefresh: true, fetch: async () => { refreshes++; return token.promise; } });
  const who = { token: 'expired', refreshToken: 'old-refresh', expiresAt: 0 };
  const wave = Promise.all([h.call('one', '/session', who), h.call('two', '/session', who)]);
  assert.equal(refreshes, 1); assert.equal(h.requests.length, 0);
  token.resolve({ status: 200, json: async () => ({ id_token: 'fresh-token', refresh_token: 'new-refresh', expires_in: '3600' }) });
  await flush(); assert.equal(h.requests.length, 2);
  assert.ok(h.requests.every(request => request.options.headers.Authorization === 'Bearer fresh-token'));
  assert.equal(who.refreshToken, 'new-refresh'); assert.ok(who.expiresAt > Date.now()); assert.equal(who.refreshing, undefined);
  h.reply(0, 200, { ok: true }); h.reply(1, 200, { ok: true }); await wave;
});

test('discarded accepted reply has explicit wire evidence and does not classify a real server error as injected', async () => {
  const h = transport();
  const accepted = h.call('discard', '/session/command', null, { command: {} }, 15000, { fault: 'discard-response' });
  h.time(31); h.reply(0, 200, { revision: 1 }); const result = await accepted;
  assert.equal(result.status, 0); assert.equal(result.sample.injectedFault, 'discard-response'); assert.equal(result.sample.wireStatus, 200); assert.equal(result.sample.ms, 31);
  const failed = h.call('server-error', '/session/command', null, {}, 15000, { fault: 'discard-response' });
  h.reply(1, 503, { error: 'Unavailable' }); const failure = await failed;
  assert.equal(failure.status, 503); assert.equal(failure.sample.injectedFault, undefined);
});

test('after-send abort is marked injected while a deadline before the injection remains an ordinary failure', async () => {
  const h = transport();
  const aborted = h.call('injected', '/session/command', null, {}, 1000, { fault: 'abort-after-send', abortAfterMs: 1 });
  const result = await aborted;
  assert.equal(h.requests[0].request.finished, true); assert.equal(h.requests[0].request.destroyed, true);
  assert.equal(result.status, 0); assert.equal(result.sample.injectedFault, 'abort-after-send'); assert.match(result.sample.error, /INJECTED_DISCONNECT/);
  const expired = h.call('ordinary-timeout', '/session/command', null, {}, 5, { fault: 'abort-after-send', abortAfterMs: 100 });
  await new Promise(resolve => setTimeout(resolve, 20));
  const failure = await expired;
  assert.equal(failure.status, 0); assert.equal(failure.sample.injectedFault, undefined); assert.match(failure.sample.error, /ABORT_ERR/);
});
