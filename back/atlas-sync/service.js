const mongoose = require('mongoose');
const storage = require('../storage');
const { EJSON } = require('bson');
const { ConfigStore, validateConnection } = require('./config');
const { hash, recordKey, decide, apply } = require('./reconcile');

const COLLECTIONS = ['customers', 'products', 'units', 'orders', 'sales', 'receipts',
  'drivers', 'vehicles', 'invoice_settings', 'companies', 'counters'];
const INTERVAL = 30000;

class SyncError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function publicError(error) {
  if (error.code === 11000) return 'A unique field duplicates another record. Correct the duplicate, then retry.';
  if (error.code === 13 || error.code === 18) return 'Atlas rejected access. Check the database user and read/write permissions.';
  return 'Cannot complete Atlas sync. Check internet, Atlas network access, credentials and database permissions; changes will be retried.';
}

class AtlasSyncService {
  constructor({ store = new ConfigStore(), getLocalDb = storage.localDb,
    getMetadataDb = storage.metadataDb,
    createClient = uri => new mongoose.mongo.MongoClient(uri, {
      tls: true, serverSelectionTimeoutMS: 7000, connectTimeoutMS: 7000, socketTimeoutMS: 15000,
      maxPoolSize: 3, readPreference: 'primary', writeConcern: { w: 'majority' },
    }), collections = COLLECTIONS, intervalMs = INTERVAL } = {}) {
    this.store = store;
    this.getLocalDb = getLocalDb;
    this.getMetadataDb = getMetadataDb;
    this.createClient = createClient;
    this.collections = collections;
    this.intervalMs = intervalMs;
    this.running = false;
    this.connection = 'not-configured';
    this.lastError = '';
    this.timer = null;
  }

  config() {
    try { return this.store.read(); }
    catch { throw new SyncError('Cannot read the saved Atlas settings. Check the connection file and encryption key on the backend.', 500); }
  }

  identity(config, db) { return hash({ host: config.host, database: config.database, localDatabase: db.databaseName }); }

  metadata(config, db) {
    const target = this.identity(config, db);
    const metadata = this.getMetadataDb();
    return { target, rows: metadata.collection('records'), runs: metadata.collection('runs') };
  }

  assertIdle() {
    if (this.running) throw new SyncError('A sync is running. Wait for it to finish, then try again.', 409);
  }

  async status() {
    const config = this.config();
    const db = this.getLocalDb();
    let pending = 0;
    let conflicts = 0;
    let run = null;
    if (config && db) {
      const metadata = this.metadata(config, db);
      [pending, conflicts, run] = await Promise.all([
        metadata.rows.countDocuments({ target: metadata.target, pending: true, conflict: { $exists: false } }),
        metadata.rows.countDocuments({ target: metadata.target, conflict: { $exists: true } }),
        metadata.runs.findOne({ _id: metadata.target }),
      ]);
    }
    return { configured: Boolean(config), host: config?.host || '', database: config?.database || '',
      enabled: config?.enabled || false, connection: config && this.connection === 'not-configured' ? 'waiting' : this.connection, running: this.running,
      localConnected: Boolean(db), localEngine: storage.engine(), pending, conflicts, lastSyncAt: run?.lastSyncAt || null,
      lastAttemptAt: run?.lastAttemptAt || null, lastError: this.lastError,
      intervalSeconds: this.intervalMs / 1000, collections: this.collections };
  }

  async save(input) {
    this.assertIdle();
    const existing = this.config();
    const next = validateConnection(input.uri || existing?.uri, input.database);
    const oldIdentity = existing && `${existing.host}/${existing.database}`;
    const newIdentity = `${next.host}/${next.database}`;
    if (existing && oldIdentity !== newIdentity && input.confirmTargetChange !== true) {
      throw new SyncError('Changing the Atlas destination starts a new merge. Confirm the destination change.', 409);
    }
    this.store.write({ ...next, enabled: input.enabled === true });
    this.connection = 'waiting';
    this.lastError = '';
    return this.status();
  }

  async test(input) {
    const existing = this.config();
    const config = validateConnection(input.uri || existing?.uri, input.database || existing?.database);
    const client = this.createClient(config.uri);
    try {
      await client.connect();
      const db = client.db(config.database);
      await db.command({ ping: 1 });
      await db.listCollections({}, { nameOnly: true }).toArray();
      return { message: 'Atlas connection successful. Sync also requires read/write and index permissions.' };
    } catch { throw new SyncError('Atlas connection failed. Check internet, the connection string, database user and Atlas network access.', 502); }
    finally { await client.close().catch(() => {}); }
  }

  async disconnect() {
    this.assertIdle();
    this.store.remove();
    this.connection = 'not-configured';
    this.lastError = '';
    return this.status();
  }

  async snapshot(db, name) {
    const documents = new Map();
    for await (const document of db.collection(name).find({})) {
      documents.set(recordKey(name, document._id), document);
    }
    return documents;
  }

  async scanLocal(config, db, metadata) {
    const snapshots = new Map();
    for (const name of this.collections) {
      const documents = await this.snapshot(db, name);
      const rows = await metadata.rows.find({ target: metadata.target, collection: name }).toArray();
      const byKey = new Map(rows.map(row => [row.key, row]));
      for (const key of new Set([...documents.keys(), ...byKey.keys()])) {
        const document = documents.get(key);
        const previous = byKey.get(key);
        const pending = hash(document) !== (previous?.baseHash ?? null);
        await metadata.rows.updateOne({ _id: `${metadata.target}:${key}` }, { $set: {
          target: metadata.target, key, collection: name, documentId: document?._id ?? previous.documentId,
          pending, localHash: hash(document),
        } }, { upsert: true });
      }
      snapshots.set(name, documents);
    }
    return snapshots;
  }

  async checkpoint(metadata, name, key, id, baseHash) {
    await metadata.rows.updateOne({ _id: `${metadata.target}:${key}` }, {
      $set: { target: metadata.target, key, collection: name, documentId: id, baseHash, pending: false },
      $unset: { conflict: '' },
    }, { upsert: true });
    const local = this.getLocalDb();
    if (local?.acknowledge) await local.acknowledge(name, id, baseHash);
  }

  async conflict(metadata, name, key, id, local, cloud, message = '') {
    // Store each snapshot separately instead of combining two documents into a
    // single metadata record. EJSON retains BSON types for the review page.
    const snapshots = this.getMetadataDb().collection('conflict_snapshots');
    const rowId = `${metadata.target}:${key}`;
    for (const [side, document] of [['local', local], ['cloud', cloud]]) {
      await snapshots.replaceOne({ _id: `${rowId}:${side}` }, { _id: `${rowId}:${side}`,
        value: document == null ? null : EJSON.stringify(document, { relaxed: false }) }, { upsert: true });
    }
    await metadata.rows.updateOne({ _id: rowId }, { $set: {
      target: metadata.target, key, collection: name, documentId: id, pending: true,
      conflict: { localHash: hash(local), cloudHash: hash(cloud), message,
        detectedAt: new Date(), localDeleted: !local, cloudDeleted: !cloud },
    } }, { upsert: true });
  }

  async copyIndexes(localDb, cloudDb, name) {
    let indexes;
    try { indexes = await localDb.collection(name).listIndexes().toArray(); }
    catch (error) { if (error.code === 26) return; throw error; }
    for (const index of indexes) {
      if (index.name === '_id_') continue;
      const options = { name: index.name };
      for (const key of ['unique', 'sparse', 'expireAfterSeconds', 'partialFilterExpression', 'collation']) {
        if (index[key] !== undefined) options[key] = index[key];
      }
      await cloudDb.collection(name).createIndex(index.key, options);
    }
  }

  async sync() {
    this.assertIdle();
    const config = this.config();
    if (!config) throw new SyncError('Save an Atlas connection first.');
    const db = this.getLocalDb();
    if (!db) throw new SyncError('The local database is disconnected. Start it before syncing.', 503);
    this.running = true;
    this.connection = 'connecting';
    this.lastError = '';
    let client;
    try {
      const metadata = this.metadata(config, db);
      await metadata.runs.updateOne({ _id: metadata.target }, { $set: { lastAttemptAt: new Date() } }, { upsert: true });
      const localSnapshots = await this.scanLocal(config, db, metadata);
      client = this.createClient(config.uri);
      await client.connect();
      const cloudDb = client.db(config.database);
      await cloudDb.command({ ping: 1 });
      this.connection = 'connected';
      for (const name of this.collections) {
        await this.copyIndexes(db, cloudDb, name);
        const local = localSnapshots.get(name);
        const cloud = await this.snapshot(cloudDb, name);
        const rows = await metadata.rows.find({ target: metadata.target, collection: name }).toArray();
        const previous = new Map(rows.map(row => [row.key, row]));
        for (const key of new Set([...local.keys(), ...cloud.keys(), ...previous.keys()])) {
          const localDocument = local.get(key) || null;
          const cloudDocument = cloud.get(key) || null;
          const row = previous.get(key);
          const id = localDocument?._id ?? cloudDocument?._id ?? row.documentId;
          let decision = decide(row?.baseHash, localDocument, cloudDocument);
          // Generated bill/voucher numbers must never move backwards. This app
          // has one local writer; Atlas edits may advance, but not reset, counters.
          if (name === 'counters' && (localDocument || cloudDocument)) {
            if (!localDocument) decision = 'pull';
            else if (!cloudDocument) decision = 'push';
            else if (Number.isSafeInteger(localDocument.seq) && Number.isSafeInteger(cloudDocument.seq)
              && localDocument.seq !== cloudDocument.seq) {
              decision = localDocument.seq > cloudDocument.seq ? 'push' : 'pull';
            }
          }
          if (decision === 'conflict') {
            await this.conflict(metadata, name, key, id, localDocument, cloudDocument);
            continue;
          }
          const desired = decision === 'pull' ? cloudDocument : localDocument;
          try {
            if (decision !== 'equal') {
              const destination = decision === 'pull' ? db : cloudDb;
              const expected = decision === 'pull' ? localDocument : cloudDocument;
              if (!await apply(destination.collection(name), expected, desired)) continue;
            }
            await this.checkpoint(metadata, name, key, id, hash(desired));
          } catch (error) {
            if (error.code !== 11000) throw error;
            await this.conflict(metadata, name, key, id, localDocument, cloudDocument, publicError(error));
          }
        }
      }
      await metadata.runs.updateOne({ _id: metadata.target }, { $set: { lastSyncAt: new Date() } }, { upsert: true });
    } catch (error) {
      this.connection = 'retrying';
      this.lastError = publicError(error);
      throw new SyncError(this.lastError, 502);
    } finally {
      if (client) await client.close().catch(() => {});
      this.running = false;
    }
    return this.status();
  }

  async listConflicts() {
    const config = this.config();
    const db = this.getLocalDb();
    if (!config || !db) return [];
    const metadata = this.metadata(config, db);
    const rows = await metadata.rows.find({ target: metadata.target, conflict: { $exists: true } })
      .sort({ 'conflict.detectedAt': -1 }).limit(100).toArray();
    return rows.map(row => ({ key: row.key, collection: row.collection,
      documentId: EJSON.stringify(row.documentId), ...row.conflict }));
  }

  async conflictDetail(key) {
    const config = this.config();
    const db = this.getLocalDb();
    if (!config || !db) throw new SyncError('Local database or Atlas connection unavailable.', 503);
    const metadata = this.metadata(config, db);
    const row = await metadata.rows.findOne({ _id: `${metadata.target}:${key}`, conflict: { $exists: true } });
    if (!row) throw new SyncError('Conflict no longer exists. Refresh the list.', 404);
    const snapshots = this.getMetadataDb().collection('conflict_snapshots');
    const [local, cloud] = await Promise.all(['local', 'cloud'].map(side => snapshots.findOne({ _id: `${row._id}:${side}` })));
    return { local: local?.value ?? null, cloud: cloud?.value ?? null,
      localHash: row.conflict.localHash, cloudHash: row.conflict.cloudHash };
  }

  async resolve(key, side, revision = {}) {
    this.assertIdle();
    if (!['local', 'cloud'].includes(side)) throw new SyncError('Choose the local or Atlas version.');
    const config = this.config();
    const db = this.getLocalDb();
    if (!config || !db) throw new SyncError('Local database or Atlas connection unavailable.', 503);
    this.running = true;
    let client;
    try {
      const metadata = this.metadata(config, db);
      const row = await metadata.rows.findOne({ _id: `${metadata.target}:${key}`, conflict: { $exists: true } });
      if (!row) throw new SyncError('Conflict no longer exists. Refresh the list.', 404);
      if (revision.localHash !== row.conflict.localHash || revision.cloudHash !== row.conflict.cloudHash) {
        throw new SyncError('The conflict versions changed. Review both versions again before choosing.', 409);
      }
      client = this.createClient(config.uri);
      await client.connect();
      const cloudDb = client.db(config.database);
      const [local, cloud] = await Promise.all([db, cloudDb].map(database => database.collection(row.collection).findOne({ _id: row.documentId })));
      if (hash(local) !== row.conflict.localHash || hash(cloud) !== row.conflict.cloudHash) {
        await this.conflict(metadata, row.collection, key, row.documentId, local, cloud);
        throw new SyncError('This record changed since the conflict was shown. Review the refreshed versions.', 409);
      }
      const destination = side === 'local' ? cloudDb : db;
      const desired = side === 'local' ? local : cloud;
      const expected = side === 'local' ? cloud : local;
      if (!await apply(destination.collection(row.collection), expected, desired)) {
        throw new SyncError('This record changed during resolution. Run sync and review it again.', 409);
      }
      await this.checkpoint(metadata, row.collection, key, row.documentId, hash(desired));
    } catch (error) {
      if (error instanceof SyncError) throw error;
      throw new SyncError(publicError(error), 502);
    } finally {
      if (client) await client.close().catch(() => {});
      this.running = false;
    }
    return this.status();
  }

  start() {
    if (this.timer) return;
    const tick = async () => {
      try { if (!this.running && this.getLocalDb() && this.config()?.enabled) await this.sync(); }
      catch (error) { this.lastError = error.message; }
    };
    this.timer = setInterval(tick, this.intervalMs);
    this.timer.unref();
    void tick();
  }

  stop() { clearInterval(this.timer); this.timer = null; }
}

module.exports = { AtlasSyncService, SyncError, COLLECTIONS, service: new AtlasSyncService() };
