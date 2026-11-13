import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { tick, assertInvariants, fail } from '../src/engine.mjs';

export const CHUNK_BYTES = 500 * 1024;
const MAX_COMPRESSED = 7 * 1024 * 1024, MAX_RAW = 128 * 1024 * 1024;
export const digest = value => createHash('sha256').update(value).digest('hex');
export function encodeState(state) {
  const json = Buffer.from(JSON.stringify(state));
  if (json.length > MAX_RAW) fail('This classroom has reached its history limit. Export its records and create a new session.', 413);
  const compressed = gzipSync(json, { level: 1 });
  if (compressed.length > MAX_COMPRESSED) fail('This classroom has reached its history limit. Export its records and create a new session.', 413);
  const chunks = [];
  for (let offset = 0; offset < compressed.length; offset += CHUNK_BYTES) chunks.push(compressed.subarray(offset, offset + CHUNK_BYTES));
  return { chunks, bytes: compressed.length, digest: digest(compressed), codec: 'gzip-json-v1' };
}
export function decodeState(chunks, metadata) {
  return decodeStateWithSize(chunks, metadata).state;
}
export function decodeStateWithSize(chunks, metadata) {
  const compressed = Buffer.concat(chunks);
  if (metadata.codec !== 'gzip-json-v1' || compressed.length !== metadata.bytes || digest(compressed) !== metadata.digest) throw new Error('Stored classroom snapshot failed its integrity check.');
  const json = gunzipSync(compressed, { maxOutputLength: MAX_RAW });
  return { state: JSON.parse(json.toString()), rawBytes: json.length };
}
// A durable due time, updated in the same transaction as the state, prevents two
// function instances or the scheduled worker from advancing the same hour twice.
export function advanceCloudClock(state, nextTickAt, now, limit = 24) {
  const records = [];
  if (state.status !== 'running') return { nextTickAt: null, records };
  let due = nextTickAt ?? now + state.secondsPerHour * 1000;
  while (state.status === 'running' && due <= now && records.length < limit) {
    const realAt = new Date(due).toISOString();
    tick(state); assertInvariants(state);
    records.push({ actor: {}, command: { type: 'tick' }, realAt, revision: state.revision });
    due += state.secondsPerHour * 1000;
  }
  return { nextTickAt: state.status === 'running' ? due : null, records };
}
