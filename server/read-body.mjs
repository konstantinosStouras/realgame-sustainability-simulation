import { fail } from '../src/engine.mjs';

// HTTP chunks may split a UTF-8 code point. Preserve bytes until the complete,
// bounded body is available instead of decoding every chunk independently.
export async function readBody(req, limit = 16000) {
  if (req.rawBody !== undefined) {
    const body = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody);
    if (body.length > limit) fail('Request too large.', 413);
    return body;
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) fail('Request too large.', 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes);
}
