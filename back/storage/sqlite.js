const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { EJSON, ObjectId } = require('bson');
const { matches, values, sortDocuments, patch, equal } = require('./query');

const context = new AsyncLocalStorage();
const registeredIndexes = new Map();
let singleton;
const encode = value => EJSON.stringify(value, { relaxed: false });
const decode = value => EJSON.parse(value, { relaxed: true });

function duplicate(message = 'A record with this unique value already exists.') {
  const error = new Error(message);
  error.code = 11000;
  return error;
}

class Cursor {
  constructor(collection, filter) { this.collection = collection; this.filter = filter; this.order = {}; this.offset = 0; this.size = Infinity; }
  sort(order) { this.order = order; return this; }
  skip(offset) { this.offset = offset; return this; }
  limit(size) { this.size = size; return this; }
  async toArray() {
    return this.collection.store.access(() => sortDocuments(this.collection.all(this.filter).filter(document => matches(document, this.filter)), this.order)
      .slice(this.offset, this.offset + this.size));
  }
  async *[Symbol.asyncIterator]() { for (const document of await this.toArray()) yield document; }
}

class Collection {
  constructor(store, namespace, name) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error('Invalid collection name.');
    this.store = store; this.namespace = namespace; this.name = name;
  }
  all(filter = {}) {
    const id = filter._id;
    if (typeof id === 'string' || typeof id === 'number' || id?.toHexString) {
      const keys = [encode(id)];
      if (typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)) keys.push(encode(new ObjectId(id)));
      return this.store.db.prepare(`SELECT payload FROM documents WHERE namespace=? AND collection=? AND id IN (${keys.map(() => '?').join(',')}) ORDER BY rowid`)
        .all(this.namespace, this.name, ...keys).map(row => decode(row.payload));
    }
    return this.store.db.prepare('SELECT payload FROM documents WHERE namespace=? AND collection=? ORDER BY rowid')
      .all(this.namespace, this.name).map(row => decode(row.payload));
  }
  find(filter = {}) { return new Cursor(this, filter); }
  async findOne(filter = {}) { return (await this.find(filter).limit(1).toArray())[0] || null; }
  async countDocuments(filter = {}) { return (await this.find(filter).toArray()).length; }
  async distinct(field, filter = {}) {
    const result = [];
    for (const document of await this.find(filter).toArray()) {
      for (const value of values(document, field)) if (value !== undefined && !result.some(item => equal(item, value))) result.push(value);
    }
    return result;
  }
  put(document, insertOnly = false) {
    if (document._id == null) document._id = new ObjectId();
    const columns = [this.namespace, this.name, encode(document._id), encode(document)];
    try {
      this.store.db.prepare(insertOnly
        ? 'INSERT INTO documents(namespace,collection,id,payload) VALUES(?,?,?,?)'
        : 'INSERT INTO documents(namespace,collection,id,payload) VALUES(?,?,?,?) ON CONFLICT(namespace,collection,id) DO UPDATE SET payload=excluded.payload')
        .run(...columns);
    } catch (error) {
      if (/UNIQUE constraint failed/.test(error.message)) throw duplicate();
      throw error;
    }
    if (this.namespace === 'business') {
      this.store.db.prepare('INSERT INTO changes(collection,id,operation,changed_at) VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET operation=excluded.operation,changed_at=excluded.changed_at')
        .run(this.name, encode(document._id), 'put', new Date().toISOString());
    }
  }
  remove(document) {
    this.store.db.prepare('DELETE FROM documents WHERE namespace=? AND collection=? AND id=?').run(this.namespace, this.name, encode(document._id));
    if (this.namespace === 'business') {
      this.store.db.prepare('INSERT INTO changes(collection,id,operation,changed_at) VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET operation=excluded.operation,changed_at=excluded.changed_at')
        .run(this.name, encode(document._id), 'delete', new Date().toISOString());
    }
  }
  async insertOne(document) { return this.store.transaction(() => { this.put(document, true); return { insertedId: document._id }; }); }
  async insertMany(documents) { return this.store.transaction(() => { for (const document of documents) this.put(document, true); return { insertedCount: documents.length }; }); }
  async updateOne(filter, update, options = {}) {
    return this.store.transaction(() => {
      let document = this.all(filter).find(item => matches(item, filter));
      const matched = Boolean(document);
      if (!document && !options.upsert) return { matchedCount: 0, modifiedCount: 0 };
      if (!document) document = Object.fromEntries(Object.entries(filter).filter(([key, value]) => !key.startsWith('$') && !(value && Object.keys(value).some(part => part.startsWith('$')))));
      patch(document, update, !matched);
      this.put(document, !matched);
      return { matchedCount: matched ? 1 : 0, modifiedCount: matched ? 1 : 0, upsertedId: matched ? null : document._id };
    });
  }
  async replaceOne(filter, desired, options = {}) {
    return this.store.transaction(() => {
      const existing = this.all(filter).find(document => matches(document, filter));
      if (!existing && !options.upsert) return { matchedCount: 0, modifiedCount: 0 };
      if (existing && !equal(existing._id, desired._id)) throw new Error('Cannot change a record ID.');
      this.put(desired, !existing);
      return { matchedCount: existing ? 1 : 0, modifiedCount: existing ? 1 : 0 };
    });
  }
  async deleteOne(filter) {
    return this.store.transaction(() => {
      const document = this.all(filter).find(item => matches(item, filter));
      if (document) this.remove(document);
      return { deletedCount: document ? 1 : 0 };
    });
  }
  async deleteMany(filter = {}) {
    return this.store.transaction(() => {
      const documents = this.all(filter).filter(item => matches(item, filter));
      for (const document of documents) this.remove(document);
      return { deletedCount: documents.length };
    });
  }
  listIndexes() {
    return { toArray: async () => [{ name: '_id_', key: { _id: 1 }, unique: true }, ...(registeredIndexes.get(this.name) || []).map(([key, options]) => ({ key, ...options,
      name: options.name || Object.entries(key).map(([field, direction]) => `${field}_${direction}`).join('_') }))] };
  }
  async createIndex(key, options = {}) {
    return this.store.transaction(() => {
      const columns = Object.keys(key).map(field => {
        if (!/^[a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*$/.test(field)) throw new Error('Unsupported SQLite index path.');
        return `json_extract(payload, '$.${field}')`;
      });
      const name = 'idx_' + crypto.createHash('sha256').update(encode({ namespace: this.namespace, collection: this.name, key })).digest('hex').slice(0, 24);
      try {
        this.store.db.exec(`CREATE ${options.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${name} ON documents(${columns.join(',')}) WHERE namespace='${this.namespace}' AND collection='${this.name}'`);
      } catch (error) { if (/UNIQUE constraint failed/.test(error.message)) throw duplicate(); throw error; }
      return name;
    });
  }
}

class SQLiteStore {
  constructor(filename) {
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('SQLite mode requires Node.js 24 or newer.');
    let DatabaseSync;
    try { ({ DatabaseSync } = require('node:sqlite')); }
    catch { throw new Error('SQLite mode requires Node.js 24 or newer.'); }
    this.filename = filename === ':memory:' ? filename : path.resolve(filename);
    if (this.filename !== ':memory:') fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    this.db = new DatabaseSync(this.filename);
    if (this.db.prepare('PRAGMA user_version').get().user_version > 1) {
      this.db.close();
      throw new Error('This SQLite database was created by a newer application version.');
    }
    this.open = true;
    this.tail = Promise.resolve();
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents(namespace TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(namespace,collection,id));
      CREATE TABLE IF NOT EXISTS changes(collection TEXT NOT NULL, id TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('put','delete')), changed_at TEXT NOT NULL, PRIMARY KEY(collection,id));
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version=1;`);
    this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING').run('installation_id', crypto.randomUUID());
    this.installationId = this.db.prepare('SELECT value FROM settings WHERE key=?').get('installation_id').value;
  }
  access(operation) {
    if (context.getStore() === this) return Promise.resolve().then(operation);
    const result = this.tail.then(() => context.run(this, operation));
    this.tail = result.catch(() => {});
    return result;
  }
  transaction(operation) {
    if (context.getStore() === this && this.inTransaction) return Promise.resolve().then(operation);
    return this.access(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      this.inTransaction = true;
      try { const result = await operation(); this.db.exec('COMMIT'); return result; }
      catch (error) { this.db.exec('ROLLBACK'); throw error; }
      finally { this.inTransaction = false; }
    });
  }
  namespace(name = 'business') {
    if (!['business', 'metadata'].includes(name)) throw new Error('Invalid storage namespace.');
    return { databaseName: `sqlite:${this.installationId}:${name}`, collection: collection => new Collection(this, name, collection),
      listCollections: () => ({ toArray: () => this.access(() => {
        const names = this.db.prepare('SELECT DISTINCT collection FROM documents WHERE namespace=?').all(name).map(row => row.collection);
        return [...new Set([...names, ...(name === 'business' ? registeredIndexes.keys() : [])])].map(collection => ({ name: collection }));
      }) }), command: async () => ({ ok: 1 }),
      acknowledge: (collection, id, baseHash) => this.transaction(async () => {
        if (name !== 'business') return;
        const current = await new Collection(this, name, collection).findOne({ _id: id });
        if (require('../atlas-sync/reconcile').hash(current) === baseHash) {
          this.db.prepare('DELETE FROM changes WHERE collection=? AND id=?').run(collection, encode(id));
        }
      }) };
  }
  async initializeIndexes() {
    for (const [name, indexes] of registeredIndexes) for (const [key, options] of indexes) await this.namespace().collection(name).createIndex(key, options);
  }
  async exportBusiness() {
    return this.transaction(async () => {
      const collections = {};
      for (const { name } of await this.namespace().listCollections().toArray()) collections[name] = await this.namespace().collection(name).find().toArray();
      return collections;
    });
  }
  async backup(destination) { return this.access(() => require('node:sqlite').backup(this.db, destination)); }
  async close() { return this.access(() => { this.db.close(); this.open = false; }); }
}

function registerIndexes(name, indexes) { registeredIndexes.set(name, indexes); }
function getStore() {
  if (!singleton || !singleton.open) {
    const filename = process.env.SQLITE_FILE || 'data/market.sqlite';
    singleton = new SQLiteStore(filename === ':memory:' ? filename : path.resolve(__dirname, '..', filename));
  }
  return singleton;
}
function existingStore() { return singleton; }
module.exports = { SQLiteStore, getStore, existingStore, registerIndexes, encode, decode };
