import { requireOpen } from './session-access.mjs';
import { testTemplate } from './test-template.mjs';
import { sessionId } from '../src/session-id.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createSession, applyCommand, tick, assertInvariants, fail, cleanText, canMessage } from '../src/engine.mjs';

const hash = token => createHash('sha256').update(token).digest('hex');
export class Store {
  constructor(path = '.data/simulation.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL, initial TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (sessionId TEXT NOT NULL REFERENCES sessions(id), userId TEXT NOT NULL REFERENCES users(id), companyId TEXT, PRIMARY KEY(sessionId,userId));
      CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id), companyId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (userId TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(userId,key));
      CREATE TABLE IF NOT EXISTS commands (seq INTEGER PRIMARY KEY AUTOINCREMENT, sessionId TEXT NOT NULL REFERENCES sessions(id), actor TEXT NOT NULL, command TEXT NOT NULL, realAt TEXT NOT NULL);
    `);
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  user(id) { const u = this.db.prepare('SELECT id,username,name,role FROM users WHERE id=?').get(id); if (!u) fail('Account not found.', 401); return { ...u }; }
  firebaseUser(claims, instructorUids = []) {
    if (!claims.uid || !claims.email_verified) fail('Verified Firebase identity required.', 403);
    const id = `firebase:${claims.uid}`, role = claims.instructor === true || instructorUids.includes(claims.uid) ? 'instructor' : 'student';
    const name = String(claims.name || claims.email?.split('@')[0] || 'Student').slice(0, 80);
    const existing = this.db.prepare('SELECT id FROM users WHERE id=?').get(id);
    if (existing) this.db.prepare('UPDATE users SET name=?,role=? WHERE id=?').run(name, role, id);
    else this.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id, `firebase-${claims.uid}`, name, role, 'firebase-only', 'no-local-password');
    return this.user(id);
  }
  addUser(username, name, password, role = 'student') {
    username = cleanText(username, 'Username', 50).toLowerCase(); name = cleanText(name, 'Display name', 80);
    if (!/^[a-z0-9._-]{3,50}$/.test(username)) fail('Username must be 3–50 letters, digits, dots, underscores or hyphens.');
    if (typeof password !== 'string' || password.length < 10 || password.length > 128) fail('Password must be 10–128 characters.');
    if (this.db.prepare('SELECT id FROM users WHERE username=?').get(username)) fail('Username already registered.', 409);
    const id = randomUUID(), salt = randomBytes(16).toString('hex'), digest = scryptSync(password, salt, 64).toString('hex');
    this.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id, username, name, role, salt, digest);
    return this.user(id);
  }
  login(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 128) fail('Invalid credentials.', 401);
    const u = this.db.prepare('SELECT * FROM users WHERE username=?').get(username.toLowerCase());
    const check = scryptSync(password, u?.salt || 'missing-account', 64);
    if (!u || !timingSafeEqual(check, Buffer.from(u.password, 'hex'))) fail('Invalid credentials.', 401);
    return this.issueToken(u.id);
  }
  issueToken(userId) {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('DELETE FROM tokens WHERE expires<?').run(Date.now());
    this.db.prepare('INSERT INTO tokens VALUES (?,?,?)').run(hash(token), userId, Date.now() + 12 * 3600000);
    return { token, user: this.user(userId) };
  }
  authenticate(token) {
    const row = this.db.prepare('SELECT userId FROM tokens WHERE hash=? AND expires>?').get(hash(token || ''), Date.now());
    if (!row) fail('Sign in to continue.', 401); return this.user(row.userId);
  }
  logout(token) { this.db.prepare('DELETE FROM tokens WHERE hash=?').run(hash(token || '')); }
  session(id) { const row = this.db.prepare('SELECT state FROM sessions WHERE id=?').get(id); if (!row) fail('Session not found.', 404); const state = JSON.parse(row.state); if (state.status === 'deleted') fail('Session not found.', 404); return state; }
  save(s) { this.db.prepare('UPDATE sessions SET state=? WHERE id=?').run(JSON.stringify(s), s.id); }
  actor(user, id) {
    this.session(id);
    const member = this.db.prepare('SELECT companyId FROM members WHERE sessionId=? AND userId=?').get(id, user.id);
    if (!member) fail('You are not a member of this session.', 403);
    if (user.role === 'student') requireOpen(this.session(id));
    return { ...user, companyId: member.companyId };
  }
  list(user) { return this.db.prepare('SELECT s.state,m.companyId FROM sessions s JOIN members m ON m.sessionId=s.id WHERE m.userId=? ORDER BY s.rowid DESC').all(user.id).map(row => { const s = JSON.parse(row.state); return { id: s.id, name: s.name, hour: s.hour, status: s.status, companyId: row.companyId }; }).filter(s => s.status !== 'deleted'); }
  create(user, opts = {}) {
    if (user.role !== 'instructor') fail('Instructor access required.', 403);
    return this.transaction(() => {
      const s = createSession({ ...opts, id: sessionId(opts.id, randomUUID) });
      if (this.db.prepare('SELECT 1 FROM sessions WHERE id=?').get(s.id)) fail('Session ID is already taken. Choose another city or a custom ID.', 409);
      const json = JSON.stringify(s); this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(s.id, json, json);
      this.db.prepare('INSERT INTO members VALUES (?,?,NULL)').run(s.id, user.id);
      for (const c of s.companies) this.db.prepare('INSERT INTO invites VALUES (?,?,?)').run(randomBytes(9).toString('base64url'), s.id, c.id);
      return s;
    });
  }
  enter(user, id, code) {
    if (typeof id === 'string') id = id.trim().toLowerCase();
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(id)) fail('Enter a valid session ID.');
    const session = this.session(id);
    if (user.role === 'instructor') { this.actor(user, id); return { sessionId: id }; }
    requireOpen(session);
    if (this.db.prepare('SELECT 1 FROM members WHERE sessionId=? AND userId=?').get(id, user.id)) return { sessionId: id };
    if (!code) return { requiresCompanyCode: true };
    const invite = this.db.prepare('SELECT sessionId FROM invites WHERE code=?').get(String(code).trim());
    if (!invite || invite.sessionId !== id) fail('Company code does not belong to this session.');
    return this.join(user, code);
  }
  join(user, code) {
    if (user.role !== 'student') fail('Only students join through company codes.', 403);
    const inv = this.db.prepare('SELECT * FROM invites WHERE code=?').get(typeof code === 'string' ? code.trim() : '');
    if (!inv) fail('Invalid company join code.');
    requireOpen(this.session(inv.sessionId));
    if (this.db.prepare('SELECT 1 FROM members WHERE sessionId=? AND userId=?').get(inv.sessionId, user.id)) fail('Already a member. Ask the instructor to change your assignment.', 409);
    this.db.prepare('INSERT INTO members VALUES (?,?,?)').run(inv.sessionId, user.id, inv.companyId); return { sessionId: inv.sessionId };
  }
  roster(user, sessionId) {
    this.actor(user, sessionId); if (user.role !== 'instructor') fail('Instructor access required.', 403);
    return { members: this.db.prepare('SELECT u.id,u.name,u.username,u.role,m.companyId FROM members m JOIN users u ON u.id=m.userId WHERE m.sessionId=?').all(sessionId), invites: this.db.prepare('SELECT code,companyId FROM invites WHERE sessionId=?').all(sessionId) };
  }
  assign(user, sessionId, userId, companyId) {
    const actor = this.actor(user, sessionId); if (user.role !== 'instructor') fail('Instructor access required.', 403);
    if (!this.session(sessionId).companies.some(c => c.id === companyId)) fail('Company not found.');
    const student = this.user(userId); if (student.role !== 'student') fail('Only student assignments can change.');
    if (!this.db.prepare('SELECT 1 FROM members WHERE sessionId=? AND userId=?').get(sessionId, userId)) fail('Student is not in this session.');
    return this.transaction(() => {
      this.db.prepare('UPDATE members SET companyId=? WHERE sessionId=? AND userId=?').run(companyId, sessionId, userId);
      const s = this.session(sessionId), realAt = new Date().toISOString(), command = { type: 'assignment', userId, companyId };
      applyCommand(s, actor, command, realAt); assertInvariants(s); this.save(s);
      this.db.prepare('INSERT INTO commands(sessionId,actor,command,realAt) VALUES (?,?,?,?)').run(sessionId, JSON.stringify(actor), JSON.stringify(command), realAt);
      return { ok: true };
    });
  }
  command(user, id, request) {
    return this.transaction(() => {
      const { key, revision, command } = request;
      if (command?.type === 'assignment') fail('Use the instructor assignment endpoint to change membership.', 403);
      if (typeof key !== 'string' || key.length < 8 || key.length > 100) fail('A unique request key is required.');
      const payload = JSON.stringify({ id, command });
      const previous = this.db.prepare('SELECT * FROM requests WHERE userId=? AND key=?').get(user.id, key);
      if (previous) { if (previous.payload !== payload) fail('Request key already used for a different decision.', 409); return JSON.parse(previous.response); }
      const actor = this.actor(user, id), s = this.session(id);
      if (revision !== s.revision) fail('The session changed. Refreshed state is available; review and submit again.', 409);
      const realAt = new Date().toISOString(), message = applyCommand(s, actor, command, realAt); assertInvariants(s);
      this.save(s);
      this.db.prepare('INSERT INTO commands(sessionId,actor,command,realAt) VALUES (?,?,?,?)').run(id, JSON.stringify(actor), JSON.stringify(command), realAt);
      const response = { message, revision: s.revision };
      this.db.prepare('INSERT INTO requests VALUES (?,?,?,?)').run(user.id, key, payload, JSON.stringify(response)); return response;
    });
  }
  runTick(id) {
    return this.transaction(() => {
      const s = this.session(id); if (s.status !== 'running') return;
      tick(s); assertInvariants(s); this.save(s);
      this.db.prepare('INSERT INTO commands(sessionId,actor,command,realAt) VALUES (?,?,?,?)').run(id, '{}', '{"type":"tick"}', new Date().toISOString());
    });
  }
  testTemplate(user, id) {
    if (user.role !== 'instructor') fail('Instructor access required.',403);
    this.actor(user,id);
    return testTemplate(JSON.parse(this.db.prepare('SELECT initial FROM sessions WHERE id=?').get(id).initial), this.session(id));
  }
  replay(user, id) {
    const viewer = this.actor(user, id); if (user.role !== 'instructor') fail('Instructor access required.', 403);
    const current = this.session(id);
    const commands = this.db.prepare('SELECT actor,command,realAt FROM commands WHERE sessionId=? ORDER BY seq').all(id).map(x => {
      const command = JSON.parse(x.command);
      if (command.type === 'message' && !canMessage(current, viewer, command.channel)) command.text = '[private message redacted]';
      return { actor: JSON.parse(x.actor), command, realAt: x.realAt };
    });
    const missingAssignments = Math.max(0, current.audit.filter(a => a.command.type === 'assignment').length - commands.filter(x => x.command.type === 'assignment').length);
    return {
      note: missingAssignments ? 'Incomplete replay: this older session has assignment transitions missing from its command history. Private chat text is redacted.' : 'Economic state, revision and audit replay includes assignment transitions. Private chat text is redacted; user accounts and membership tables are not recreated.',
      complete: missingAssignments === 0,
      missingAssignments,
      initial: JSON.parse(this.db.prepare('SELECT initial FROM sessions WHERE id=?').get(id).initial),
      commands
    };
  }
  seedDemo() {
    const found = this.db.prepare("SELECT id FROM users WHERE username='demo-instructor'").get();
    if (found) return;
    const teacher = this.addUser('demo-instructor', 'Demo instructor', randomBytes(24).toString('hex'), 'instructor');
    const s = this.create(teacher, { name: 'Sustainability Studio · demonstration' });
    for (let i = 1; i <= 3; i++) {
      const u = this.addUser(`demo-student-${i}`, ['Alex · Helio', 'Sam · Northstar', 'Robin · Verdant'][i - 1], randomBytes(24).toString('hex'));
      this.db.prepare('INSERT INTO members VALUES (?,?,?)').run(s.id, u.id, `company-${i}`);
    }
    // A short, reproducible setup sequence gives the demonstration meaningful charts.
    let key = 0;
    for (let i = 1; i <= 3; i++) {
      const u = this.user(this.db.prepare('SELECT id FROM users WHERE username=?').get(`demo-student-${i}`).id);
      const send = command => this.command(u, s.id, { key: `demo-seed-${++key}`, revision: this.session(s.id).revision, command });
      send({ type: 'invest', kind: 'delivery' });
      send({ type: 'invest', kind: 'purchasing' });
      for (const item of ['cell', 'frame', 'controller']) send({ type: 'reorder', supplierId: `${item}-circular`, point: item === 'cell' ? 6000 : 250, qty: item === 'cell' ? 7200 : 300, enabled: true });
      if (i === 2) send({ type: 'shifts', shifts: [true, true, false] });
      if (i === 3) send({ type: 'energy', energyId: 'wind' });
    }
    this.command(teacher, s.id, { key: 'demo-first-period', revision: this.session(s.id).revision, command: { type: 'step', hours: 72 } });
  }
  close() { this.db.close(); }
}
