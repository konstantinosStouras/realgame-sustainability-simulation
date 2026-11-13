import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const compress = promisify(gzip);
const waiting = [];
let active = 0;
async function compressionSlot(action) {
  if (active >= 4) await new Promise(resolve => waiting.push(resolve));
  else active++;
  try { return await action(); }
  finally {
    const next = waiting.shift();
    if (next) next(); else active--;
  }
}

function acceptsGzip(header = '') {
  const preferences = new Map();
  for (const item of String(header).toLowerCase().split(',')) {
    const [coding, ...parameters] = item.trim().split(';');
    let quality = 1;
    for (const parameter of parameters) {
      const match = parameter.trim().match(/^q\s*=\s*(.*)$/);
      if (match) quality = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(match[1]) ? Number(match[1]) : 0;
    }
    preferences.set(coding.trim(), quality);
  }
  return (preferences.get('gzip') ?? preferences.get('*') ?? 0) > 0;
}

// Large private histories otherwise consume roughly 190 MiB for one 120-student
// refresh. Compress off the event loop; level 1 favors interactive response time.
export async function sendViewResponse(req, res, json) {
  const vary = res.getHeader('Vary');
  res.setHeader('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
  let body = json;
  // Length avoids flattening every large actor+shared-state string while queued.
  if ((json.length >= 1024 || Buffer.byteLength(json) >= 1024) && acceptsGzip(req.headers['accept-encoding'])) {
    // zlib eagerly copies strings to native input buffers, even when its worker
    // pool is busy. Admit only four jobs so 120 reads cannot allocate 120 copies.
    body = await compressionSlot(() => res.destroyed ? null : compress(json, { level: 1 }));
    if (body === null || res.destroyed) return;
    res.setHeader('Content-Encoding', 'gzip');
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
