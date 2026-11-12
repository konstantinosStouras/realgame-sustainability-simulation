import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Store } from './store.mjs';
import { publicView, fail } from '../src/engine.mjs';
import { firebaseVerifier } from './firebase-auth.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export function createApp({ store = new Store(process.env.DATA_PATH || '.data/simulation.sqlite'), demo = false, allowedOrigin = process.env.ALLOWED_ORIGIN || '', projectId = demo ? '' : (process.env.FIREBASE_PROJECT_ID || 'stouras-sustainability-2026'), verifyFirebase = projectId ? firebaseVerifier(projectId, { checkRevoked: process.env.FIREBASE_CHECK_REVOKED === 'true' }) : null } = {}) {
  if (demo) store.seedDemo();
  const attempts = new Map();
  const origins = allowedOrigin.split(',').map(x => x.trim()).filter(Boolean);
  const server = http.createServer(async (req, res) => {
    const send = (code, value, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }); res.end(type.startsWith('application/json') ? JSON.stringify(value) : value); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const origin = req.headers.origin;
      const ownOrigin = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
      if (origin && origin !== ownOrigin && !origins.includes(origin)) fail('This origin is not allowed.', 403);
      if (origins.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.writeHead(204); res.end(); return; }
      if (url.pathname === '/api/health') return send(200, { ok: true, demo, version: 1, classroomAccounting: true, sessionLifecycle: true, auth: verifyFirebase ? 'firebase' : 'local-demo', projectId });
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') fail('Method not allowed.', 405);
        const files = { '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css', '/theme.css': 'theme.css', '/theme.mjs': 'theme.mjs', '/google-g.png': 'google-g.png', '/app.mjs': 'app.mjs', '/src/engine.mjs': 'src/engine.mjs', '/src/solo.mjs': 'src/solo.mjs', '/src/firebase-client.mjs': 'src/firebase-client.mjs', '/firebase-config.mjs': 'firebase-config.mjs', '/notes/model.md': 'notes/model.md' };
        const file = files[url.pathname]; if (!file) fail('Not found.', 404);
        const type = file.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.png') ? 'image/png' : file.endsWith('.md') ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8';
        res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; img-src 'self' data: https://*.googleusercontent.com; style-src 'self'; script-src 'self' https://www.gstatic.com https://apis.google.com; frame-src https://*.firebaseapp.com https://accounts.google.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
        return send(200, await readFile(resolve(ROOT, file)), type);
      }
      let body = {};
      if (req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) fail('Use JSON requests.', 415);
        let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 16000) fail('Request too large.', 413); }
        try { body = JSON.parse(data || '{}'); } catch { fail('Invalid JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Expected a JSON object.');
      }
      if (req.method === 'POST' && ['/api/login', '/api/register', '/api/demo'].includes(url.pathname)) {
        if (verifyFirebase && url.pathname !== '/api/demo') fail('Use Firebase Google or email sign-in.', 403);
        const address = req.socket.remoteAddress, now = Date.now();
        const rate = attempts.get(address) || { n: 0, reset: now + 60000 };
        if (rate.reset < now) { rate.n = 0; rate.reset = now + 60000; }
        if (++rate.n > 30) fail('Too many authentication attempts. Try again in a minute.', 429); attempts.set(address, rate);
        if (url.pathname === '/api/login') return send(200, store.login(body.username, body.password));
        if (url.pathname === '/api/register') {
          const result = store.transaction(() => { const user = store.addUser(body.username, body.name, body.password); store.join(user, body.code); return store.issueToken(user.id); });
          return send(201, result);
        }
        if (!demo) fail('Demo access is disabled.', 403);
        if (!['demo-instructor', 'demo-student-1', 'demo-student-2', 'demo-student-3'].includes(body.username)) fail('Unknown demonstration account.');
        return send(200, store.issueToken(store.db.prepare('SELECT id FROM users WHERE username=?').get(body.username).id));
      }
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const user = verifyFirebase ? store.firebaseUser(await verifyFirebase(token), (process.env.FIREBASE_INSTRUCTOR_UIDS || '').split(',').filter(Boolean)) : store.authenticate(token);
      if (url.pathname === '/api/me' && req.method === 'GET') return send(200, { user, sessions: store.list(user) });
      if (url.pathname === '/api/logout' && req.method === 'POST') { store.logout(token); return send(200, { ok: true }); }
      if (url.pathname === '/api/join' && req.method === 'POST') return send(200, store.join(user, body.code));
      if (url.pathname === '/api/sessions' && req.method === 'POST') return send(201, { id: store.create(user, body).id });
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(command|roster|assign|replay))?$/);
      if (!match) fail('Not found.', 404);
      const id = match[1], action = match[2], actor = store.actor(user, id);
      if (!action && req.method === 'GET') return send(200, { state: publicView(store.session(id), actor, url.searchParams.get('company')), actor });
      if (action === 'command' && req.method === 'POST') return send(200, store.command(user, id, body));
      if (action === 'roster' && req.method === 'GET') return send(200, store.roster(user, id));
      if (action === 'assign' && req.method === 'POST') return send(200, store.assign(user, id, body.userId, body.companyId));
      if (action === 'replay' && req.method === 'GET') return send(200, store.replay(user, id));
      fail('Method not allowed.', 405);
    } catch (error) { if (!error.status) console.error(error); if (!res.headersSent) send(error.status || 500, { error: error.status ? error.message : 'Server error. No decision was committed.' }); }
  });
  const next = new Map();
  const timer = setInterval(() => {
    const rows = store.db.prepare('SELECT id,state FROM sessions').all();
    for (const row of rows) {
      const s = JSON.parse(row.state);
      if (s.status !== 'running') { next.delete(s.id); continue; }
      if (!next.has(s.id)) next.set(s.id, Date.now() + s.secondsPerHour * 1000);
      if (Date.now() >= next.get(s.id)) {
        try { store.runTick(s.id); } catch (error) { console.error('Clock stopped:', error.message); s.status = 'paused'; store.save(s); }
        next.set(s.id, Date.now() + s.secondsPerHour * 1000);
      }
    }
    for (const [key, rate] of attempts) if (rate.reset < Date.now()) attempts.delete(key);
  }, 250);
  timer.unref(); server.on('close', () => clearInterval(timer));
  return { server, store };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const demo = process.argv.includes('--demo');
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3000);
  if (demo && !['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Demo sign-in is restricted to loopback. Use normal accounts for network deployment.');
  const { server } = createApp({ demo });
  server.listen(port, host, () => console.log(`Sustainability Studio: http://${host}:${port}${demo ? ' (local demonstration access enabled)' : ''}`));
}
