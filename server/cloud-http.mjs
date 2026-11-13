import { readExportForm, sendExport } from './export-download.mjs';
import { readBody } from './read-body.mjs';
import { fail } from '../src/engine.mjs';
import { sendViewResponse } from './view-response.mjs';

export function createCloudHandler({ store, verifyFirebase, projectId, allowedOrigins }) {
  const origins = new Set(allowedOrigins);
  return async (req, res) => {
    const sendJSON = (status, json) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(json); };
    const send = (status, value) => sendJSON(status, JSON.stringify(value));
    try {
      const origin = req.headers.origin;
      if (origin && !origins.has(origin)) fail('This origin is not allowed.', 403);
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.writeHead(204); res.end(); return; }
      const url = new URL(req.url, 'https://classroom.invalid'), path = url.pathname;
      if (path === '/api/health' && req.method === 'GET') return send(200, { ok: true, demo: false, version: 1, classroomAccounting: true, atomicSessionSettings: true, operatingCostSettings: true, pricingInventorySettings: true, sessionLifecycle: true, sessionUpdates: true, sessionLinks: true, attachmentExport: true, testClassroom: true, auth: 'firebase', projectId, persistence: 'firestore', region: 'europe-west2' });
      if (!path.startsWith('/api/')) fail('Not found.', 404);
      if (path === '/api/export-download') {
        const credentials = await readExportForm(req);
        const user = await store.firebaseUser(await verifyFirebase(credentials.token));
        return sendExport(res, credentials.id, await store.replay(user, credentials.id));
      }
      const header = req.headers.authorization || '';
      if (!header.startsWith('Bearer ')) fail('Sign in to continue.', 401);
      const claims = await verifyFirebase(header.slice(7)), user = await store.firebaseUser(claims);
      let body = {};
      if (req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) fail('Use JSON requests.', 415);
        if (req.body !== undefined) { if ((req.rawBody?.length || Buffer.byteLength(JSON.stringify(req.body))) > 16000) fail('Request too large.', 413); body = req.body; }
        else { const data = (await readBody(req)).toString('utf8'); try { body = JSON.parse(data || '{}'); } catch { fail('Invalid JSON.'); } }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Expected a JSON object.');
      }
      if (path === '/api/me' && req.method === 'GET') return send(200, { user, sessions: await store.list(user) });
      if (path === '/api/logout' && req.method === 'POST') return send(200, { ok: true });
      if (path === '/api/enter' && req.method === 'POST') return send(200, await store.enter(user, body.sessionId, body.code));
      if (path === '/api/join' && req.method === 'POST') return send(200, await store.join(user, body.code));
      if (path === '/api/sessions' && req.method === 'POST') return send(201, { id: (await store.create(user, body)).id });
      const match = path.match(/^\/api\/sessions\/([^/]+)(?:\/(command|roster|assign|replay|test-template|updates))?$/);
      if (!match) fail('Not found.', 404);
      const [, id, action] = match;
      if (action === 'updates' && req.method === 'GET') {
        const controller = new AbortController(), close = () => controller.abort();
        res.on('close', close);
        try {
          const update = await store.updates(user, id, Number(url.searchParams.get('revision')), controller.signal);
          if (!controller.signal.aborted) send(200, update);
        } finally { res.off('close', close); }
        return;
      }
      if (!action && req.method === 'GET') {
        const preview = url.searchParams.get('company');
        const json = store.viewJSON ? await store.viewJSON(user, id, preview) : JSON.stringify(await store.view(user, id, preview));
        return await sendViewResponse(req, res, json);
      }
      if (action === 'command' && req.method === 'POST') return send(200, await store.command(user, id, body));
      if (action === 'roster' && req.method === 'GET') return send(200, await store.roster(user, id));
      if (action === 'assign' && req.method === 'POST') return send(200, await store.assign(user, id, body.userId, body.companyId));
      if (action === 'test-template' && req.method === 'GET') return send(200, await store.testTemplate(user, id));
      if (action === 'replay' && req.method === 'GET') return send(200, await store.replay(user, id));
      fail('Method not allowed.', 405);
    } catch (error) {
      if (!error.status) console.error('Classroom request failed', { code: error.code, message: error.message });
      if (!res.headersSent) send(error.status || 503, { error: error.status ? error.message : 'The server could not confirm the result. Retry the same decision safely.' });
    }
  };
}
