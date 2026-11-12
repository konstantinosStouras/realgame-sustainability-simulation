// Minimal transactional test double: serializes commits, enforces read-before-
// write, and rolls back staged writes. Live/emulator tests cover SDK behavior.
const clone = value => structuredClone(value);
class Snapshot {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this.exists = data !== undefined; this.value = data; }
  data() { return clone(this.value); }
}
class Document {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1); }
  collection(name) { return new Query(this.db, `${this.path}/${name}`); }
  get() { return Promise.resolve(new Snapshot(this, this.db.data.get(this.path))); }
  async set(data, options) { this.db.data.set(this.path, clone(options?.merge ? { ...this.db.data.get(this.path), ...data } : data)); }
}
class Query {
  constructor(db, path, filters = [], order) { Object.assign(this, { db, path, filters, order }); }
  doc(id) { return new Document(this.db, `${this.path}/${id}`); }
  where(field, op, value) { if (op !== '==') throw new Error('Unsupported test query'); return new Query(this.db, this.path, [...this.filters, [field, value]], this.order); }
  orderBy(field) { return new Query(this.db, this.path, this.filters, field); }
  async get() {
    const docs = [...this.db.data].filter(([key, data]) => key.startsWith(this.path + '/') && !key.slice(this.path.length + 1).includes('/') && this.filters.every(([field, value]) => data[field] === value)).map(([key, data]) => new Snapshot(new Document(this.db, key), data));
    if (this.order) docs.sort((a, b) => a.data()[this.order] - b.data()[this.order]);
    return { docs, empty: docs.length === 0 };
  }
}
export class MemoryFirestore {
  data = new Map();
  queue = Promise.resolve();
  collection(name) { return new Query(this, name); }
  getAll(...refs) { return Promise.all(refs.map(ref => ref.get())); }
  runTransaction(fn) {
    const run = async () => {
      const writes = [];
      const tx = {
        get: ref => { if (writes.length) throw new Error('Firestore reads must precede writes'); return ref.get(); },
        getAll: (...refs) => { if (writes.length) throw new Error('Firestore reads must precede writes'); return this.getAll(...refs); },
        set: (ref, value, options) => writes.push({ type: 'set', ref, value, options }),
        update: (ref, value) => writes.push({ type: 'set', ref, value, options: { merge: true } }),
        create: (ref, value) => writes.push({ type: 'create', ref, value }),
        delete: ref => writes.push({ type: 'delete', ref })
      };
      const result = await fn(tx), next = new Map(this.data);
      for (const { type, ref, value, options } of writes) {
        if (type === 'create' && next.has(ref.path)) throw new Error('Document already exists');
        if (type === 'delete') next.delete(ref.path);
        else next.set(ref.path, clone(options?.merge ? { ...next.get(ref.path), ...value } : value));
      }
      this.data = next;
      return result;
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }
}
