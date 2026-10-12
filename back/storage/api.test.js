const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EJSON } = require('bson');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'market-sqlite-api-test-'));
process.env.DB_ENGINE = 'sqlite';
process.env.SQLITE_FILE = path.join(directory, 'market.sqlite');
process.env.ATLAS_SYNC_DATA_DIR = path.join(directory, 'atlas-settings');
// Isolate this test server from any access key set in the user's local config.
process.env.ATLAS_SYNC_ADMIN_TOKEN = '';
const app = require('../app');
const mongoose = require('mongoose');
const { getStore } = require('./sqlite');

test('SQLite API supports masters, billing transactions, reports, backup/import and optional sync without local MongoDB', { timeout: 60000 }, async () => {
  await app.locals.databaseReady;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(url, method = 'GET', body, expected = 200) {
    const response = await fetch(`${base}/api${url}`, { method,
      headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  }
  const bill = { customer: { name: 'SQLite Alice' }, products: [{ name: 'Rice', quantity: 10, bags: 2,
    single_price: 5, bagRate: 3, wage: 2, commission: 1 }],
    bill_details: { date: '2026-10-12', freight: 8, debit: 5, credit: 10 } };
  try {
    assert.equal((await request('/health')).engine, 'sqlite');
    assert.equal((await fetch(`${base}/api/not-a-route`)).status, 404);
    if (fs.existsSync(path.join(__dirname, '../../fornt/build/index.html'))) {
      assert.equal((await fetch(`${base}/sale-entry`, { headers: { Accept: 'text/html' } })).status, 200);
    }
    assert.equal(mongoose.connection.readyState, 0, 'No local MongoDB connection should be attempted');
    const alice = await request('/customers', 'POST', { name: 'SQLite Alice', oldBalance: 100 }, 201);
    const product = await request('/products', 'POST', { name: 'Rice', price: 5, unit: 'Tray' }, 201);
    await request(`/products/${product._id}`, 'PUT', { price: 6 });
    assert.equal((await request(`/products/${product._id}`)).Price, 6);
    await request('/units', 'POST', { name: '  Sack  ' }, 201);
    await request('/units', 'POST', { name: 'sack' }, 409);
    await request('/units?name=Sack', 'DELETE');
    await request('/units', 'POST', { name: 'Sack' }, 201);
    assert.ok((await request('/units')).some(unit => unit.name === 'Tray'));
    for (const type of ['drivers', 'vehicles']) {
      const master = await request(`/${type}`, 'POST', { name: 'Sample' }, 201);
      await request(`/${type}/${master._id}`, 'PUT', { name: 'Updated' });
      assert.equal((await request(`/${type}/${master._id}`)).name, 'Updated');
      await request(`/${type}/${master._id}`, 'DELETE');
      await request(`/${type}/${master._id}`, 'GET', undefined, 404);
    }
    const settings = await request('/invoice-settings', 'POST', { name: 'SQLite Market' }, 201);
    await request('/invoice-settings', 'POST', { name: 'Another' }, 409);
    assert.equal((await request('/invoice-settings/active'))._id, settings._id);

    const sale = await request('/sales', 'POST', bill, 201);
    assert.equal(sale.bill_details.bill_amount, 70);
    assert.equal(sale.bill_details.order_sno, '1');
    assert.equal((await request(`/customers/${alice._id}`)).oldBalance, 155);
    const changed = { ...bill, products: [{ ...bill.products[0], quantity: 20 }] };
    await request(`/sales/${sale._id}`, 'PUT', changed);
    assert.equal((await request(`/customers/${alice._id}`)).oldBalance, 205);
    const receipt = await request('/receipts', 'POST', { customerName: 'SQLite Alice', amount: 40 }, 201);
    assert.equal(receipt.receipt_no, '1');
    assert.equal((await request(`/customers/${alice._id}`)).oldBalance, 165);
    await request(`/receipts/${receipt._id}`, 'PUT', { customerName: 'SQLite Alice', amount: 20 });
    assert.equal((await request('/ledger?customer=SQLite%20Alice')).closing, 185);
    const report = await request('/sales?page=1&limit=1&product=Rice&startDate=2026-10-12&endDate=2026-10-12');
    assert.equal(report.total, 1);
    await request(`/sales/${sale._id}`, 'DELETE');
    assert.equal((await request(`/customers/${alice._id}`)).oldBalance, 80);
    await request(`/receipts/${receipt._id}`, 'DELETE');
    assert.equal((await request(`/customers/${alice._id}`)).oldBalance, 100);

    // A validation failure after balance/counter work must roll all work back.
    const failed = { ...bill, products: [{ ...bill.products[0], quantity: -1 }] };
    await request('/sales', 'POST', failed, 400);
    assert.equal((await request(`/customers/${alice._id}`)).oldBalance, 100);
    assert.equal((await getStore().namespace().collection('counters').findOne({ _id: 'sale' })).seq, 1);

    const simple = { customerName: 'SQLite Alice', products: [{ name: 'Rice', quantity: 2, single_price: 5 }] };
    const simultaneous = await Promise.all(Array.from({ length: 8 }, () => request('/sales', 'POST', simple, 201)));
    assert.equal(new Set(simultaneous.map(item => item.bill_details.order_sno)).size, 8);
    assert.equal((await request(`/customers/${alice._id}`)).oldBalance, 180);
    const order = await request('/orders', 'POST', simple, 201);
    await request(`/orders/${order._id}`, 'PUT', { ...simple, bill_details: { order_sno: order.bill_details.order_sno } });
    assert.equal((await request('/orders?product=Rice')).length, 1);
    await request(`/orders/${order._id}`, 'DELETE');

    const backupResponse = await fetch(`${base}/api/backup/download`);
    assert.equal(backupResponse.status, 200);
    const backupText = await backupResponse.text();
    const payload = EJSON.parse(backupText, { relaxed: true });
    assert.equal(payload.collections.sales.length, 8);
    assert.equal(payload.collections.customers[0]._id.toString(), alice._id);
    assert.ok(payload.collections.customers[0].createdAt instanceof Date);
    const invalidRestore = EJSON.stringify({ collections: { customers: [{ ...payload.collections.customers[0], oldBalance: 999 }],
      units: [{ _id: 'a', nameKey: 'duplicate' }, { _id: 'b', nameKey: 'duplicate' }] } });
    const rejected = await fetch(`${base}/api/backup/restore`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: invalidRestore });
    assert.equal(rejected.status, 500);
    assert.equal((await request(`/customers/${alice._id}`)).oldBalance, 180, 'Failed restore must retain all original data');
    const restored = await fetch(`${base}/api/backup/restore`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: backupText });
    assert.equal(restored.status, 200);
    assert.equal((await request('/sales')).length, 8);

    const nativeBackup = await fetch(`${base}/api/backup/download-sqlite`);
    assert.equal(nativeBackup.status, 200);
    assert.equal(Buffer.from(await nativeBackup.arrayBuffer()).subarray(0, 16).toString(), 'SQLite format 3\0');
    const sync = await request('/atlas-sync/status');
    assert.equal(sync.localEngine, 'sqlite');
    assert.equal(sync.localConnected, true);
    assert.equal(sync.configured, false);
    await request('/atlas-sync/connection', 'PUT', { uri: 'mongodb+srv://user:example@sample.mongodb.net/', database: 'cloud_test', enabled: false });
    const service = require('../atlas-sync/service').service;
    service.createClient = () => ({ connect: async () => { throw new Error('Offline simulation'); }, close: async () => {} });
    await request('/atlas-sync/sync', 'POST', {}, 502);
    assert.ok((await request('/atlas-sync/status')).pending > 0);
    await request('/atlas-sync/connection', 'DELETE');
    assert.equal(mongoose.connection.readyState, 0);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await getStore().close();
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('market-sqlite-api-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
