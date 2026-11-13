import { requireOpen } from './session-access.mjs';
import { waitForSessionUpdate } from './session-updates.mjs';
import { testTemplate } from './test-template.mjs';
import { sessionId } from '../src/session-id.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { createSession, applyCommand, assertInvariants, publicView, publicViewJSON, canMessage, fail } from '../src/engine.mjs';
import { encodeState, decodeStateWithSize, digest, advanceCloudClock } from './cloud-state.mjs';

export class FirestoreStore {
  constructor(db, { prefix = 'studio', now = Date.now, viewCacheMaxBytes = 32 * 1024 * 1024, viewCacheTtlMs = 30000 } = {}) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(prefix)) throw new Error('Invalid Firestore namespace');
    if (!Number.isSafeInteger(viewCacheMaxBytes) || viewCacheMaxBytes < 0 || !Number.isSafeInteger(viewCacheTtlMs) || viewCacheTtlMs < 0) throw new Error('Invalid view cache limits');
    this.db = db; this.prefix = prefix; this.now = now;
    this.viewClockTasks = new Map();
    this.commandWrites = new Map();
    this.viewSnapshots = new Map(); this.viewSnapshotTasks = new Map();
    this.viewCacheBytes = 0; this.viewCacheMaxBytes = viewCacheMaxBytes; this.viewCacheTtlMs = viewCacheTtlMs;
    for (const name of ['Users', 'Sessions', 'Members', 'Invites', 'Requests']) this[name.toLowerCase()] = db.collection(prefix + name);
  }
  userRef(id) { return this.users.doc(digest(id)); }
  memberRef(id, userId) { return this.members.doc(digest(JSON.stringify([id, userId]))); }
  sessionRef(id) { if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) fail('Session not found.', 404); return this.sessions.doc(id); }
  async firebaseUser(claims) {
    if (!claims.uid || !claims.email_verified) fail('Verified Firebase identity required.', 403);
    const user = { id: `firebase:${claims.uid}`, username: `firebase-${claims.uid}`, name: String(claims.name || 'Student').slice(0, 80), role: claims.instructor === true ? 'instructor' : 'student' };
    const ref = this.userRef(user.id), old = await ref.get(), previous = old.exists ? old.data() : null;
    if (!previous || Object.entries(user).some(([key, value]) => previous[key] !== value)) await ref.set(user);
    return user;
  }
  async actor(tx, user, id) {
    if (user.role === 'instructor') return { ...user, companyId: null };
    const member = await tx.get(this.memberRef(id, user.id));
    if (!member.exists) fail('You are not a member of this session.', 403);
    const session = await tx.get(this.sessionRef(id));
    if (!session.exists || session.data().status === 'deleted') fail('Session not found.', 404);
    requireOpen(session.data());
    return { ...user, companyId: member.data().companyId };
  }
  async readState(tx, ref, metadata, initial = false) {
    // Mutating transactions and exports always read their own snapshot.
    return (await this.readSnapshot(tx, ref, metadata, initial)).state;
  }
  async readSnapshot(tx, ref, metadata, initial = false) {
    const info = initial ? metadata.initial : metadata;
    const refs = Array.from({ length: info.chunkCount }, (_, i) => ref.collection(initial ? 'initialChunks' : 'stateChunks').doc(String(i)));
    const docs = await tx.getAll(...refs);
    if (docs.some(d => !d.exists)) throw new Error('Classroom snapshot is incomplete.');
    return decodeStateWithSize(docs.map(d => Buffer.from(d.data().data)), info);
  }
  dropViewSnapshot(key) {
    const entry = this.viewSnapshots.get(key);
    if (entry) { this.viewCacheBytes -= entry.rawBytes; this.viewSnapshots.delete(key); }
  }
  async readViewState(tx, ref, metadata) {
    // Membership/access and metadata were just read in this caller's transaction.
    // A verified content digest identifies the same immutable snapshot across
    // transactions; never cache an actor, preview or authorization decision.
    const key = JSON.stringify([ref.id, metadata.digest, metadata.codec, metadata.bytes, metadata.chunkCount]);
    for (const [cachedKey, entry] of this.viewSnapshots) if (entry.expiresAt <= this.now()) this.dropViewSnapshot(cachedKey);
    const cached = this.viewSnapshots.get(key);
    if (cached) {
      this.viewSnapshots.delete(key); this.viewSnapshots.set(key, cached);
      return cached.state;
    }
    if (this.viewSnapshotTasks.has(key)) return this.viewSnapshotTasks.get(key);
    const task = (async () => {
      const snapshot = await this.readSnapshot(tx, ref, metadata);
      // Charge uncompressed JSON bytes, not gzip size. Large but valid snapshots
      // still work; they simply bypass the completed cache. At most four
      // snapshots survive a request, within the shared raw-byte budget.
      if (this.viewCacheTtlMs && snapshot.rawBytes <= this.viewCacheMaxBytes) {
        while (this.viewSnapshots.size && (this.viewSnapshots.size >= 4 || this.viewCacheBytes + snapshot.rawBytes > this.viewCacheMaxBytes)) this.dropViewSnapshot(this.viewSnapshots.keys().next().value);
        this.viewSnapshots.set(key, { ...snapshot, expiresAt: this.now() + this.viewCacheTtlMs });
        this.viewCacheBytes += snapshot.rawBytes;
      }
      return snapshot.state;
    })();
    this.viewSnapshotTasks.set(key, task);
    try { return await task; }
    finally { if (this.viewSnapshotTasks.get(key) === task) this.viewSnapshotTasks.delete(key); }
  }
  writeState(tx, ref, state, metadata, nextTickAt) {
    const encoded = encodeState(state), { chunks, ...info } = encoded;
    chunks.forEach((data, i) => tx.set(ref.collection('stateChunks').doc(String(i)), { data }));
    for (let i = chunks.length; i < (metadata.chunkCount || 0); i++) tx.delete(ref.collection('stateChunks').doc(String(i)));
    tx.set(ref, { ...metadata, ...info, chunkCount: chunks.length, id: state.id, name: state.name, hour: state.hour, status: state.status, studentAccess: state.studentAccess !== false, revision: state.revision, nextTickAt });
  }
  log(tx, ref, actor, command, realAt, revision) {
    tx.create(ref.collection('commands').doc(String(revision).padStart(12, '0')), { actor, command, realAt, revision });
  }
  async list(user) {
    if (user.role === 'instructor') {
      const sessions = await this.sessions.orderBy('createdAt', 'desc').get();
      return sessions.docs.filter(doc => doc.data().status !== 'deleted').map(doc => {
        const { name, hour, status, createdAt } = doc.data();
        return { id: doc.id, name, hour, status, companyId: null, createdAt };
      });
    }
    const members = await this.members.where('userId', '==', user.id).get();
    if (members.empty) return [];
    const docs = await this.db.getAll(...members.docs.map(m => this.sessionRef(m.data().sessionId)));
    return docs.flatMap((doc, i) => doc.exists && doc.data().status !== 'deleted' ? [{ id: doc.id, name: doc.data().name, hour: doc.data().hour, status: doc.data().status, companyId: members.docs[i].data().companyId, createdAt: doc.data().createdAt }] : []).sort((a, b) => b.createdAt - a.createdAt);
  }
  async create(user, opts = {}) {
    if (user.role !== 'instructor') fail('Instructor access required.', 403);
    const state = createSession({ ...opts, id: sessionId(opts.id, randomUUID) }), encoded = encodeState(state);
    const ref = this.sessionRef(state.id), invites = state.companies.map(c => ({ code: randomBytes(12).toString('base64url'), companyId: c.id, sessionId: state.id }));
    await this.db.runTransaction(async tx => {
      if ((await tx.get(ref)).exists) fail('Session ID is already taken. Choose another city or a custom ID.', 409);
      const metadata = { createdAt: this.now(), ownerId: user.id, initial: { codec: encoded.codec, bytes: encoded.bytes, digest: encoded.digest, chunkCount: encoded.chunks.length } };
      this.writeState(tx, ref, state, metadata, null);
      encoded.chunks.forEach((data, i) => tx.create(ref.collection('initialChunks').doc(String(i)), { data }));
      tx.create(this.memberRef(state.id, user.id), { sessionId: state.id, userId: user.id, companyId: null });
      for (const invite of invites) tx.create(this.invites.doc(digest(invite.code)), invite);
    });
    return state;
  }
  async enter(user, id, code) {
    if (typeof id === 'string') id = id.trim().toLowerCase();
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(id)) fail('Enter a valid session ID.');
    return this.db.runTransaction(async tx => {
      const session = await tx.get(this.sessionRef(id));
      if (!session.exists || session.data().status === 'deleted') fail('Session not found.', 404);
      if (user.role === 'instructor') return { sessionId: id };
      requireOpen(session.data());
      const member = this.memberRef(id, user.id), old = await tx.get(member);
      if (old.exists) return { sessionId: id };
      if (!code) return { requiresCompanyCode: true };
      if (typeof code !== 'string' || code.length > 100) fail('Invalid company join code.');
      const invite = await tx.get(this.invites.doc(digest(code.trim())));
      if (!invite.exists || invite.data().sessionId !== id) fail('Company code does not belong to this session.');
      tx.create(member, { sessionId: id, companyId: invite.data().companyId, userId: user.id });
      return { sessionId: id };
    });
  }
  async join(user, code) {
    if (user.role !== 'student') fail('Only students join through company codes.', 403);
    if (typeof code !== 'string' || code.trim().length > 100) fail('Invalid company join code.');
    return this.db.runTransaction(async tx => {
      const invite = await tx.get(this.invites.doc(digest(code.trim())));
      if (!invite.exists) fail('Invalid company join code.');
      const { sessionId, companyId } = invite.data(), member = this.memberRef(sessionId, user.id);
      const [old, session] = await tx.getAll(member, this.sessionRef(sessionId));
      if (!session.exists || session.data().status === 'deleted') fail('Session not found.', 404);
      requireOpen(session.data());
      if (old.exists) fail('Already a member. Ask the instructor to change your assignment.', 409);
      tx.create(member, { sessionId, companyId, userId: user.id });
      return { sessionId };
    });
  }
  async readViewSnapshot(user, id) {
    return this.db.runTransaction(async tx => {
      const actor = await this.actor(tx, user, id), ref = this.sessionRef(id), doc = await tx.get(ref);
      if (!doc.exists || doc.data().status === 'deleted') fail('Session not found.', 404);
      const metadata = doc.data(), state = await this.readViewState(tx, ref, metadata);
      return { actor, state, nextTickAt: metadata.nextTickAt };
    }, { readOnly: true });
  }
  async catchUpViewClock(id) {
    // A classroom-wide update wakes every browser. Share only the clock work,
    // never a user's authorization or filtered response. Firestore still
    // serializes this transaction against commands and other function instances.
    if (this.viewClockTasks.has(id)) return this.viewClockTasks.get(id);
    const task = this.db.runTransaction(async tx => {
      const ref = this.sessionRef(id), doc = await tx.get(ref);
      if (!doc.exists || doc.data().status === 'deleted') fail('Session not found.', 404);
      const metadata = doc.data();
      if (metadata.status !== 'running' || metadata.nextTickAt > this.now()) return;
      const state = await this.readState(tx, ref, metadata);
      const clock = advanceCloudClock(state, metadata.nextTickAt, this.now());
      if (!clock.records.length) return;
      this.writeState(tx, ref, state, metadata, clock.nextTickAt);
      for (const record of clock.records) this.log(tx, ref, record.actor, record.command, record.realAt, record.revision);
    });
    this.viewClockTasks.set(id, task);
    try { await task; }
    finally { if (this.viewClockTasks.get(id) === task) this.viewClockTasks.delete(id); }
  }
  async currentViewSnapshot(user, id) {
    let snapshot = await this.readViewSnapshot(user, id);
    const isDue = value => value.state.status === 'running' && value.nextTickAt != null && value.nextTickAt <= this.now();
    if (isDue(snapshot)) {
      await this.catchUpViewClock(id);
      // Membership and access can change while the clock transaction waits.
      // Reauthorize and read metadata/chunks together at a new consistent time.
      snapshot = await this.readViewSnapshot(user, id);
    }
    return { ...snapshot, catchingUp: isDue(snapshot) };
  }
  async view(user, id, preview) {
    const { actor, state, catchingUp } = await this.currentViewSnapshot(user, id);
    return { actor, state: publicView(state, actor, preview), catchingUp };
  }
  async viewJSON(user, id, preview) {
    const { actor, state, catchingUp } = await this.currentViewSnapshot(user, id);
    // Each component is JSON encoded; the state is never exposed as mutable
    // references. Authorization and clock catch-up are shared with view().
    return `{"actor":${JSON.stringify(actor)},"state":${publicViewJSON(state, actor, preview)},"catchingUp":${JSON.stringify(catchingUp)}}`;
  }
  async updates(user, id, revision, signal) {
    if (!Number.isSafeInteger(revision) || revision < 0) fail('Invalid session revision.');
    // Reauthorize every connection; no state reads, clock advances or writes.
    await this.db.runTransaction(tx => this.actor(tx, user, id), { readOnly: true });
    return waitForSessionUpdate(this.sessionRef(id), revision, user.role !== 'instructor', signal);
  }
  async roster(user, id) {
    if (user.role !== 'instructor') fail('Instructor access required.', 403);
    return this.db.runTransaction(async tx => {
      const session = await tx.get(this.sessionRef(id));
      if (!session.exists || session.data().status === 'deleted') fail('Session not found.', 404);
      const members = await tx.get(this.members.where('sessionId', '==', id));
      const invites = await tx.get(this.invites.where('sessionId', '==', id));
      const users = members.empty ? [] : await tx.getAll(...members.docs.map(m => this.userRef(m.data().userId)));
      return { members: users.filter(u => u.exists).map(u => ({ ...u.data(), companyId: members.docs.find(m => m.data().userId === u.data().id).data().companyId })), invites: invites.docs.map(i => ({ code: i.data().code, companyId: i.data().companyId })) };
    }, { readOnly: true });
  }
  async command(user, id, request) {
    this.commandWrites ||= new Map();
    const { key, revision, command } = request;
    if (command?.type === 'assignment') fail('Use the instructor assignment endpoint to change membership.', 403);
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) fail('A unique request key is required.');
    const requestRef = this.requests.doc(digest(JSON.stringify([user.id, key]))), payload = digest(JSON.stringify({ id, command }));
    const isPlainPause = (actor, metadata) => actor.role === 'instructor' && command?.type === 'clock' && command.status === 'paused'
      && !Array.isArray(command) && Object.keys(command).length === 2 && Object.hasOwn(command, 'type') && Object.hasOwn(command, 'status')
      && Number.isSafeInteger(revision) && revision >= 0 && revision <= metadata.revision;
    const run = async () => {
      const execute = () => this.db.runTransaction(async tx => {
        const actor = await this.actor(tx, user, id), previous = await tx.get(requestRef);
        if (previous.exists) { if (previous.data().payload !== payload) fail('Request key already used for a different decision.', 409); return { response: previous.data().response }; }
        const ref = this.sessionRef(id), doc = await tx.get(ref);
        if (!doc.exists || doc.data().status === 'deleted') fail('Session not found.', 404);
        const metadata = doc.data();
        const plainPause = isPlainPause(actor, metadata);
        // A paused classroom cannot accrue ticks. Reject obsolete decisions from
        // current metadata before copying and decoding its growing history. Keep
        // fresh authorization and exact-retry receipts ahead of this shortcut.
        if (metadata.status !== 'running' && revision !== metadata.revision && !plainPause) fail('The session changed. Refreshed state is available; review and submit again.', 409);
        const state = await this.readState(tx, ref, metadata);
        const previousHour = state.hour;
        const clockNow = this.now(), clock = advanceCloudClock(state, metadata.nextTickAt, clockNow);
        // A plain instructor stop has no economic options to review. Other
        // readers' ticks must not make a one-second clock impossible to pause.
        // Lifecycle changes still require the exact reviewed metadata revision.
        const pauseAfterCatchup = (plainPause && (state.status !== 'running' || clock.nextTickAt > clockNow))
          || (actor.role === 'instructor' && ['closeSession', 'deleteSession'].includes(command?.type) && revision === metadata.revision && state.status === 'running' && clock.nextTickAt > clockNow);
        if (clock.records.length && !pauseAfterCatchup) {
          this.writeState(tx, ref, state, metadata, clock.nextTickAt);
          for (const record of clock.records) this.log(tx, ref, record.actor, record.command, record.realAt, record.revision);
          // Commit elapsed time before reporting a stale decision; throwing here
          // would roll back the ticks and allow a pause to discard elapsed time.
          return { clockAdvanced: true, retryPause: plainPause, advancedHours: state.hour - previousHour, remainingHours: state.endHour - state.hour };
        }
        if (revision !== state.revision && !pauseAfterCatchup) fail('The session changed. Refreshed state is available; review and submit again.', 409);
        if (plainPause && ['paused', 'completed'].includes(state.status)) {
          // Completion may occur during catch-up. A stop must never reopen it,
          // and an already stopped clock needs no extra simulation revision.
          if (clock.records.length) {
            this.writeState(tx, ref, state, metadata, clock.nextTickAt);
            for (const record of clock.records) this.log(tx, ref, record.actor, record.command, record.realAt, record.revision);
          }
          const response = { message: state.status === 'completed' ? 'Session already completed.' : 'Clock already paused.', revision: state.revision };
          tx.create(requestRef, { userId: user.id, sessionId: id, payload, response, createdAt: this.now() });
          return { response };
        }
        const realAt = new Date(this.now()).toISOString();
        const previousSpeed = state.secondsPerHour;
        const message = applyCommand(state, actor, command, realAt); assertInvariants(state);
        const speedChanged = state.secondsPerHour !== previousSpeed;
        const nextTickAt = state.status !== 'running' ? null : command.type === 'clock' || speedChanged ? this.now() + state.secondsPerHour * 1000 : metadata.nextTickAt;
        this.writeState(tx, ref, state, metadata, nextTickAt);
        for (const record of clock.records) this.log(tx, ref, record.actor, record.command, record.realAt, record.revision);
        this.log(tx, ref, actor, command, realAt, state.revision);
        const response = { message, revision: state.revision };
        tx.create(requestRef, { userId: user.id, sessionId: id, payload, response, createdAt: this.now() });
        return { response };
      });
      let remainingPauseBatches;
      for (;;) {
        const outcome = await execute();
        // Keep each transaction bounded, reauthorize every batch, and account for
        // all elapsed hours before stopping. Only the option-free stop retries.
        if (outcome.retryPause) {
          remainingPauseBatches ??= Math.ceil(outcome.remainingHours / 24);
          if (outcome.advancedHours <= 0 || remainingPauseBatches-- <= 0) fail('The shared clock is still catching up. Retry the pause.', 409);
          continue;
        }
        if (outcome.clockAdvanced) fail('The shared clock advanced. Refreshed state is available; review and submit again.', 409);
        return outcome.response;
      }
    };
    for (;;) {
      // Share only admission to an active writer, never authorization/results.
      // After it settles, waiters fan out fresh read-only preflights. They do
      // not queue119 stale requests behind119 serial network transactions.
      const active = this.commandWrites.get(id);
      if (active) { await active.catch(() => {}); continue; }
      const previous = await this.db.runTransaction(async tx => {
        const actor = await this.actor(tx, user, id), receipt = await tx.get(requestRef);
        if (receipt.exists) {
          if (receipt.data().payload !== payload) fail('Request key already used for a different decision.', 409);
          return { response: receipt.data().response };
        }
        const doc = await tx.get(this.sessionRef(id));
        if (!doc.exists || doc.data().status === 'deleted') fail('Session not found.', 404);
        const metadata = doc.data();
        if (metadata.status !== 'running' && revision !== metadata.revision && !isPlainPause(actor, metadata)) fail('The session changed. Refreshed state is available; review and submit again.', 409);
        return null;
      }, { readOnly: true });
      if (previous) return previous.response;
      // Another matching preflight may have admitted a writer while we read.
      if (this.commandWrites.has(id)) continue;
      const task = run(); this.commandWrites.set(id, task);
      try { return await task; }
      finally { if (this.commandWrites.get(id) === task) this.commandWrites.delete(id); }
    }
  }
  async assign(user, id, userId, companyId) {
    if (user.role !== 'instructor') fail('Instructor access required.', 403);
    if (typeof userId !== 'string') fail('Student is required.');
    return this.db.runTransaction(async tx => {
      const actor = await this.actor(tx, user, id), ref = this.sessionRef(id);
      const [doc, student, member] = await tx.getAll(ref, this.userRef(userId), this.memberRef(id, userId));
      if (!doc.exists || doc.data().status === 'deleted') fail('Session not found.', 404);
      if (!student.exists || student.data().role !== 'student' || !member.exists) fail('Student is not in this session.');
      const metadata = doc.data(), state = await this.readState(tx, ref, metadata);
      const command = { type: 'assignment', userId, companyId }, realAt = new Date(this.now()).toISOString();
      if (!state.companies.some(c => c.id === companyId)) fail('Company not found.');
      applyCommand(state, actor, command, realAt); assertInvariants(state);
      tx.update(this.memberRef(id, userId), { companyId });
      this.writeState(tx, ref, state, metadata, metadata.nextTickAt);
      this.log(tx, ref, actor, command, realAt, state.revision);
      return { ok: true };
    });
  }
  async testTemplate(user, id) {
    if (user.role !== 'instructor') fail('Instructor access required.', 403);
    return this.db.runTransaction(async tx => {
      const ref = this.sessionRef(id), doc = await tx.get(ref);
      if (!doc.exists || doc.data().status === 'deleted') fail('Session not found.',404);
      const current = await this.readState(tx, ref, doc.data());
      const initial = await this.readState(tx, ref, doc.data(), true);
      return testTemplate(initial, current);
    }, { readOnly: true });
  }
  async replay(user, id) {
    if (user.role !== 'instructor') fail('Instructor access required.', 403);
    return this.db.runTransaction(async tx => {
      const ref = this.sessionRef(id), doc = await tx.get(ref);
      if (!doc.exists || doc.data().status === 'deleted') fail('Session not found.', 404);
      const metadata = doc.data();
      const state = await this.readState(tx, ref, metadata), initial = await this.readState(tx, ref, metadata, true);
      const records = await tx.get(ref.collection('commands').orderBy('revision'));
      const commands = records.docs.map(d => { const { actor, command, realAt } = d.data(); if (command.type === 'message' && !canMessage(state, { ...user, companyId: null }, command.channel)) command.text = '[private message redacted]'; return { actor, command, realAt }; });
      return { initial, commands, complete: true, missingAssignments: 0, note: 'Economic replay includes assignments. Private chat text is redacted; accounts and membership records are not recreated.' };
    }, { readOnly: true });
  }
  async runDueClocks() {
    const running = await this.sessions.where('status', '==', 'running').get();
    const failures = [];
    for (const row of running.docs) {
      if (row.data().nextTickAt > this.now()) continue;
      try {
        await this.db.runTransaction(async tx => {
          const doc = await tx.get(row.ref); if (!doc.exists || doc.data().status !== 'running') return;
          const metadata = doc.data(), state = await this.readState(tx, row.ref, metadata), clock = advanceCloudClock(state, metadata.nextTickAt, this.now(), 120);
          if (!clock.records.length) return;
          this.writeState(tx, row.ref, state, metadata, clock.nextTickAt);
          for (const record of clock.records) this.log(tx, row.ref, record.actor, record.command, record.realAt, record.revision);
        });
      } catch (error) {
        const failure = { sessionId: row.id, at: this.now(), code: String(error.code || error.status || 'clock-failed'), message: error.status ? error.message : 'Automatic clock could not advance. See server logs.' };
        failures.push(failure);
        console.error('Classroom clock failed', { ...failure, cause: error.message });
        // Record diagnostics separately: the failed tick transaction remains
        // rolled back, and one corrupt/oversized session cannot stop the rest.
        try { await row.ref.set({ lastClockError: { at: failure.at, code: failure.code, message: failure.message } }, { merge: true }); }
        catch (recordError) { console.error('Could not save classroom clock error', { sessionId: row.id, message: recordError.message }); }
      }
    }
    return { failures };
  }
}
