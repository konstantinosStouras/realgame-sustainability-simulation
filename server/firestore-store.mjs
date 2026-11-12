import { sessionId } from '../src/session-id.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { createSession, applyCommand, assertInvariants, publicView, canMessage, fail } from '../src/engine.mjs';
import { encodeState, decodeState, digest, advanceCloudClock } from './cloud-state.mjs';

export class FirestoreStore {
  constructor(db, { prefix = 'studio', now = Date.now } = {}) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(prefix)) throw new Error('Invalid Firestore namespace');
    this.db = db; this.prefix = prefix; this.now = now;
    for (const name of ['Users', 'Sessions', 'Members', 'Invites', 'Requests']) this[name.toLowerCase()] = db.collection(prefix + name);
  }
  userRef(id) { return this.users.doc(digest(id)); }
  memberRef(id, userId) { return this.members.doc(digest(JSON.stringify([id, userId]))); }
  sessionRef(id) { if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) fail('Session not found.', 404); return this.sessions.doc(id); }
  async firebaseUser(claims) {
    if (!claims.uid || !claims.email_verified) fail('Verified Firebase identity required.', 403);
    const user = { id: `firebase:${claims.uid}`, username: `firebase-${claims.uid}`, name: String(claims.name || 'Student').slice(0, 80), role: claims.instructor === true ? 'instructor' : 'student' };
    const ref = this.userRef(user.id), old = await ref.get();
    if (!old.exists || JSON.stringify(old.data()) !== JSON.stringify(user)) await ref.set(user);
    return user;
  }
  async actor(tx, user, id) {
    if (user.role === 'instructor') return { ...user, companyId: null };
    const member = await tx.get(this.memberRef(id, user.id));
    if (!member.exists) fail('You are not a member of this session.', 403);
    return { ...user, companyId: member.data().companyId };
  }
  async readState(tx, ref, metadata, initial = false) {
    const info = initial ? metadata.initial : metadata;
    const refs = Array.from({ length: info.chunkCount }, (_, i) => ref.collection(initial ? 'initialChunks' : 'stateChunks').doc(String(i)));
    const docs = await tx.getAll(...refs);
    if (docs.some(d => !d.exists)) throw new Error('Classroom snapshot is incomplete.');
    return decodeState(docs.map(d => Buffer.from(d.data().data)), info);
  }
  writeState(tx, ref, state, metadata, nextTickAt) {
    const encoded = encodeState(state), { chunks, ...info } = encoded;
    chunks.forEach((data, i) => tx.set(ref.collection('stateChunks').doc(String(i)), { data }));
    for (let i = chunks.length; i < (metadata.chunkCount || 0); i++) tx.delete(ref.collection('stateChunks').doc(String(i)));
    tx.set(ref, { ...metadata, ...info, chunkCount: chunks.length, id: state.id, name: state.name, hour: state.hour, status: state.status, revision: state.revision, nextTickAt });
  }
  log(tx, ref, actor, command, realAt, revision) {
    tx.create(ref.collection('commands').doc(String(revision).padStart(12, '0')), { actor, command, realAt, revision });
  }
  async list(user) {
    if (user.role === 'instructor') {
      const sessions = await this.sessions.orderBy('createdAt', 'desc').get();
      return sessions.docs.map(doc => {
        const { name, hour, status, createdAt } = doc.data();
        return { id: doc.id, name, hour, status, companyId: null, createdAt };
      });
    }
    const members = await this.members.where('userId', '==', user.id).get();
    if (members.empty) return [];
    const docs = await this.db.getAll(...members.docs.map(m => this.sessionRef(m.data().sessionId)));
    return docs.flatMap((doc, i) => doc.exists ? [{ id: doc.id, name: doc.data().name, hour: doc.data().hour, status: doc.data().status, companyId: members.docs[i].data().companyId, createdAt: doc.data().createdAt }] : []).sort((a, b) => b.createdAt - a.createdAt);
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
  async join(user, code) {
    if (user.role !== 'student') fail('Only students join through company codes.', 403);
    if (typeof code !== 'string' || code.trim().length > 100) fail('Invalid company join code.');
    return this.db.runTransaction(async tx => {
      const invite = await tx.get(this.invites.doc(digest(code.trim())));
      if (!invite.exists) fail('Invalid company join code.');
      const { sessionId, companyId } = invite.data(), member = this.memberRef(sessionId, user.id);
      const [old, session] = await tx.getAll(member, this.sessionRef(sessionId));
      if (!session.exists) fail('Session not found.', 404);
      if (old.exists) fail('Already a member. Ask the instructor to change your assignment.', 409);
      tx.create(member, { sessionId, companyId, userId: user.id });
      return { sessionId };
    });
  }
  async view(user, id, preview) {
    return this.db.runTransaction(async tx => {
      const actor = await this.actor(tx, user, id), ref = this.sessionRef(id), doc = await tx.get(ref);
      if (!doc.exists) fail('Session not found.', 404);
      const metadata = doc.data(), state = await this.readState(tx, ref, metadata);
      const clock = advanceCloudClock(state, metadata.nextTickAt, this.now());
      if (clock.records.length) {
        this.writeState(tx, ref, state, metadata, clock.nextTickAt);
        for (const record of clock.records) this.log(tx, ref, record.actor, record.command, record.realAt, record.revision);
      }
      return { actor, state: publicView(state, actor, preview), catchingUp: state.status === 'running' && clock.nextTickAt <= this.now() };
    });
  }
  async roster(user, id) {
    if (user.role !== 'instructor') fail('Instructor access required.', 403);
    return this.db.runTransaction(async tx => {
      const session = await tx.get(this.sessionRef(id));
      if (!session.exists) fail('Session not found.', 404);
      const members = await tx.get(this.members.where('sessionId', '==', id));
      const invites = await tx.get(this.invites.where('sessionId', '==', id));
      const users = members.empty ? [] : await tx.getAll(...members.docs.map(m => this.userRef(m.data().userId)));
      return { members: users.filter(u => u.exists).map(u => ({ ...u.data(), companyId: members.docs.find(m => m.data().userId === u.data().id).data().companyId })), invites: invites.docs.map(i => ({ code: i.data().code, companyId: i.data().companyId })) };
    });
  }
  async command(user, id, request) {
    const { key, revision, command } = request;
    if (command?.type === 'assignment') fail('Use the instructor assignment endpoint to change membership.', 403);
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) fail('A unique request key is required.');
    const requestRef = this.requests.doc(digest(JSON.stringify([user.id, key]))), payload = digest(JSON.stringify({ id, command }));
    const outcome = await this.db.runTransaction(async tx => {
      const actor = await this.actor(tx, user, id), previous = await tx.get(requestRef);
      if (previous.exists) { if (previous.data().payload !== payload) fail('Request key already used for a different decision.', 409); return { response: previous.data().response }; }
      const ref = this.sessionRef(id), doc = await tx.get(ref);
      if (!doc.exists) fail('Session not found.', 404);
      const metadata = doc.data();
      const state = await this.readState(tx, ref, metadata);
      const clockNow = this.now(), clock = advanceCloudClock(state, metadata.nextTickAt, clockNow);
      // A reviewed instructor pause may stop after catch-up in the same commit.
      // Requiring another round trip could make a one-second clock unpausable.
      const pauseAfterCatchup = actor.role === 'instructor' && command?.type === 'clock' && command.status === 'paused' && revision === metadata.revision && state.status === 'running' && clock.nextTickAt > clockNow;
      if (clock.records.length && !pauseAfterCatchup) {
        this.writeState(tx, ref, state, metadata, clock.nextTickAt);
        for (const record of clock.records) this.log(tx, ref, record.actor, record.command, record.realAt, record.revision);
        // Commit elapsed time before reporting a stale decision; throwing here
        // would roll back the ticks and allow a pause to discard elapsed time.
        return { clockAdvanced: true };
      }
      if (revision !== state.revision && !pauseAfterCatchup) fail('The session changed. Refreshed state is available; review and submit again.', 409);
      const realAt = new Date(this.now()).toISOString();
      const message = applyCommand(state, actor, command, realAt); assertInvariants(state);
      const nextTickAt = state.status !== 'running' ? null : command.type === 'clock' ? this.now() + state.secondsPerHour * 1000 : metadata.nextTickAt;
      this.writeState(tx, ref, state, metadata, nextTickAt);
      for (const record of clock.records) this.log(tx, ref, record.actor, record.command, record.realAt, record.revision);
      this.log(tx, ref, actor, command, realAt, state.revision);
      const response = { message, revision: state.revision };
      tx.create(requestRef, { userId: user.id, sessionId: id, payload, response, createdAt: this.now() });
      return { response };
    });
    if (outcome.clockAdvanced) fail('The shared clock advanced. Refreshed state is available; review and submit again.', 409);
    return outcome.response;
  }
  async assign(user, id, userId, companyId) {
    if (user.role !== 'instructor') fail('Instructor access required.', 403);
    if (typeof userId !== 'string') fail('Student is required.');
    return this.db.runTransaction(async tx => {
      const actor = await this.actor(tx, user, id), ref = this.sessionRef(id);
      const [doc, student, member] = await tx.getAll(ref, this.userRef(userId), this.memberRef(id, userId));
      if (!doc.exists) fail('Session not found.', 404);
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
  async replay(user, id) {
    if (user.role !== 'instructor') fail('Instructor access required.', 403);
    return this.db.runTransaction(async tx => {
      const ref = this.sessionRef(id), doc = await tx.get(ref);
      if (!doc.exists) fail('Session not found.', 404);
      const metadata = doc.data();
      const state = await this.readState(tx, ref, metadata), initial = await this.readState(tx, ref, metadata, true);
      const records = await tx.get(ref.collection('commands').orderBy('revision'));
      const commands = records.docs.map(d => { const { actor, command, realAt } = d.data(); if (command.type === 'message' && !canMessage(state, { ...user, companyId: null }, command.channel)) command.text = '[private message redacted]'; return { actor, command, realAt }; });
      return { initial, commands, complete: true, missingAssignments: 0, note: 'Economic replay includes assignments. Private chat text is redacted; accounts and membership records are not recreated.' };
    });
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
