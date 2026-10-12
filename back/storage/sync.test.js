const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('bson');
const { SQLiteStore } = require('./sqlite');
const { AtlasSyncService } = require('../atlas-sync/service');
const { recordKey } = require('../atlas-sync/reconcile');

test('SQLite sync uploads/downloads, recovers offline writes, resolves conflicts and acknowledges only unchanged records', async () => {
  const localStore = new SQLiteStore(':memory:');
  const cloudStore = new SQLiteStore(':memory:');
  const local = localStore.namespace();
  const cloud = cloudStore.namespace();
  let offline = false;
  const config = { host: 'sample.mongodb.net', uri: 'mongodb+srv://user:example@sample.mongodb.net/', database: 'cloud_test', enabled: true };
  const options = { store: { read: () => config }, getLocalDb: () => local,
    getMetadataDb: () => localStore.namespace('metadata'), collections: ['customers'],
    createClient: () => ({ connect: async () => { if (offline) throw new Error('Offline'); }, db: () => cloud, close: async () => {} }) };
  const id = new ObjectId();
  try {
    const service = new AtlasSyncService(options);
    await local.collection('customers').insertOne({ _id: id, name: 'Local', updatedAt: new Date('2026-01-01') });
    await cloud.collection('customers').insertOne({ _id: 'cloud-only', name: 'Cloud' });
    await service.sync();
    assert.equal(await local.collection('customers').countDocuments(), 2);
    assert.equal(await cloud.collection('customers').countDocuments(), 2);
    assert.equal(localStore.db.prepare('SELECT count(*) AS n FROM changes').get().n, 0);
    offline = true;
    await local.collection('customers').updateOne({ _id: id }, { $set: { name: 'Offline local change' } });
    await local.collection('customers').deleteOne({ _id: 'cloud-only' });
    await assert.rejects(() => service.sync(), /Cannot complete Atlas sync/);
    assert.equal((await service.status()).pending, 2);
    assert.equal(localStore.db.prepare('SELECT count(*) AS n FROM changes').get().n, 2);
    offline = false;
    const restarted = new AtlasSyncService(options);
    await restarted.sync();
    assert.equal((await cloud.collection('customers').findOne({ _id: id })).name, 'Offline local change');
    assert.equal(await cloud.collection('customers').findOne({ _id: 'cloud-only' }), null);
    assert.equal(localStore.db.prepare('SELECT count(*) AS n FROM changes').get().n, 0);
    await cloud.collection('customers').updateOne({ _id: id }, { $set: { name: 'Cloud change' } });
    await restarted.sync();
    assert.equal((await local.collection('customers').findOne({ _id: id })).name, 'Cloud change');
    await local.collection('customers').updateOne({ _id: id }, { $set: { name: 'Local conflict' } });
    await cloud.collection('customers').updateOne({ _id: id }, { $set: { name: 'Cloud conflict' } });
    await restarted.sync();
    assert.equal((await restarted.status()).conflicts, 1);
    const key = recordKey('customers', id);
    await restarted.resolve(key, 'cloud', await restarted.conflictDetail(key));
    assert.equal((await local.collection('customers').findOne({ _id: id })).name, 'Cloud conflict');
    assert.equal(localStore.db.prepare('SELECT count(*) AS n FROM changes').get().n, 0);

    // A write after the snapshot must retain its durable queue entry.
    const oldHash = require('../atlas-sync/reconcile').hash(await local.collection('customers').findOne({ _id: id }));
    await local.collection('customers').updateOne({ _id: id }, { $set: { name: 'Newer edit' } });
    await local.acknowledge('customers', id, oldHash);
    assert.equal(localStore.db.prepare('SELECT count(*) AS n FROM changes').get().n, 1);
    await restarted.sync();
    assert.equal((await cloud.collection('customers').findOne({ _id: id })).name, 'Newer edit');
  } finally { await localStore.close(); await cloudStore.close(); }
});

test('SQLite interoperates with MongoDB as the sync destination', {
  skip: process.env.RUN_SQLITE_MONGO_INTEGRATION !== '1', timeout: 30000,
}, async () => {
  const mongoose = require('mongoose');
  const { randomBytes } = require('node:crypto');
  const connection = process.env.ATLAS_SYNC_TEST_URI || 'mongodb://127.0.0.1:27017';
  const client = new mongoose.mongo.MongoClient(connection, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  const name = `market_sqlite_sync_test_${randomBytes(8).toString('hex')}`;
  const cloud = client.db(name);
  const store = new SQLiteStore(':memory:');
  const local = store.namespace();
  const service = new AtlasSyncService({
    store: { read: () => ({ uri: 'mongodb+srv://user:example@sample.mongodb.net/', host: 'sample.mongodb.net', database: name }) },
    getLocalDb: () => local, getMetadataDb: () => store.namespace('metadata'), collections: ['customers'],
    createClient: () => new mongoose.mongo.MongoClient(connection),
  });
  const id = new ObjectId();
  try {
    await local.collection('customers').insertOne({ _id: id, name: 'SQLite upload', createdAt: new Date('2026-01-01'), oldBalance: 12.5 });
    await service.sync();
    const saved = await cloud.collection('customers').findOne({ _id: id });
    assert.equal(saved.name, 'SQLite upload');
    assert.ok(saved.createdAt instanceof Date);
    await cloud.collection('customers').updateOne({ _id: id }, { $set: { name: 'MongoDB download' } });
    await service.sync();
    assert.equal((await local.collection('customers').findOne({ _id: id })).name, 'MongoDB download');
    await local.collection('customers').deleteOne({ _id: id });
    await service.sync();
    assert.equal(await cloud.collection('customers').findOne({ _id: id }), null);
  } finally {
    assert.ok(name.startsWith('market_sqlite_sync_test_'));
    await cloud.dropDatabase();
    await client.close();
    await store.close();
  }
});
