const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ObjectId } = require('bson');
const { SQLiteStore } = require('./sqlite');
const { apply } = require('../atlas-sync/reconcile');

test('SQLite persists BSON IDs/dates and protects writes with atomic comparisons and rollback', async () => {
  const store = new SQLiteStore(':memory:');
  const collection = store.namespace().collection('sales');
  const id = new ObjectId();
  const document = { _id: id, customer: { name: 'Test customer' }, date: new Date('2026-01-02'),
    products: [{ name: 'Rice', quantity: 2 }], amount: 20 };
  try {
    await collection.insertOne(document);
    const saved = await collection.findOne({ _id: id.toHexString() });
    assert.ok(saved.date instanceof Date);
    assert.equal(saved._id.toHexString(), id.toHexString());
    assert.equal((await collection.find({ 'products.name': { $regex: '^rice$', $options: 'i' } }).toArray()).length, 1);
    assert.equal((await collection.find({ date: { $gte: new Date('2026-01-01'), $lte: new Date('2026-01-03') } }).toArray()).length, 1);
    await collection.updateOne({ _id: id }, { $set: { amount: 30 } });
    assert.equal(await apply(collection, saved, { ...saved, amount: 50 }), false);
    assert.equal(await apply(collection, saved, null), false);
    assert.equal((await collection.findOne({ _id: id })).amount, 30);
    const before = store.db.prepare('SELECT * FROM changes').all();
    await assert.rejects(() => store.transaction(async () => {
      await collection.updateOne({ _id: id }, { $set: { amount: 999 } });
      await collection.insertOne({ _id: 'temporary', amount: 3 });
      throw new Error('Force rollback');
    }), /Force rollback/);
    assert.equal((await collection.findOne({ _id: id })).amount, 30);
    assert.equal(await collection.findOne({ _id: 'temporary' }), null);
    assert.deepEqual(store.db.prepare('SELECT * FROM changes').all(), before);
    const current = await collection.findOne({ _id: id });
    assert.equal(await apply(collection, current, null), true);
    assert.equal(store.db.prepare('SELECT operation FROM changes').get().operation, 'delete');
  } finally { await store.close(); }
});

test('unique indexes, durable restart, and a WAL-safe native backup retain complete data', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'market-sqlite-storage-test-'));
  const filename = path.join(directory, 'market.sqlite');
  let store = new SQLiteStore(filename);
  let restored;
  try {
    const units = store.namespace().collection('units');
    await units.createIndex({ nameKey: 1 }, { unique: true });
    await units.insertOne({ _id: 'unit-1', name: 'Bag', nameKey: 'bag' });
    await assert.rejects(() => units.insertOne({ _id: 'unit-2', name: 'BAG', nameKey: 'bag' }), error => error.code === 11000);
    await store.namespace('metadata').collection('records').insertOne({ _id: 'checkpoint', baseHash: 'base' });
    const backupFile = path.join(directory, 'backup.sqlite');
    await store.backup(backupFile);
    assert.equal(fs.readFileSync(backupFile).subarray(0, 16).toString(), 'SQLite format 3\0');
    restored = new SQLiteStore(backupFile);
    assert.equal(restored.namespace().databaseName, store.namespace().databaseName, 'Backup relocation must preserve sync identity');
    assert.equal(await restored.namespace().collection('units').countDocuments(), 1);
    assert.equal((await restored.namespace('metadata').collection('records').findOne({ _id: 'checkpoint' })).baseHash, 'base');
    await store.close();
    store = new SQLiteStore(filename);
    assert.equal((await store.namespace().collection('units').findOne({ _id: 'unit-1' })).name, 'Bag');
    assert.equal(Object.hasOwn(await store.exportBusiness(), 'records'), false);
  } finally {
    if (store.open) await store.close();
    if (restored?.open) await restored.close();
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('market-sqlite-storage-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a newer SQLite schema version is rejected without changing it', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'market-sqlite-schema-test-'));
  const filename = path.join(directory, 'future.sqlite');
  const store = new SQLiteStore(filename);
  try {
    store.db.exec('PRAGMA user_version=2');
    await store.close();
    assert.throws(() => new SQLiteStore(filename), /newer application version/);
    const db = new (require('node:sqlite').DatabaseSync)(filename);
    try { assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2); }
    finally { db.close(); }
  } finally {
    if (store.open) await store.close();
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('market-sqlite-schema-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
