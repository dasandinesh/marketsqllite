const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SQLiteStore } = require('./sqlite');

test('the SQLite launch command serves the built frontend and persists data independently', {
  skip: !fs.existsSync(path.join(__dirname, '../../fornt/build/index.html')), timeout: 30000,
}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'market-sqlite-launch-test-'));
  const filename = path.join(directory, 'market.sqlite');
  const child = spawn(process.execPath, [path.join(__dirname, '../sqlite-server.js')], {
    windowsHide: true,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', SQLITE_FILE: filename,
      ATLAS_SYNC_DATA_DIR: path.join(directory, 'no-atlas-connection'), ATLAS_SYNC_ADMIN_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let store;
  try {
    const port = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('SQLite startup timed out')), 15000);
      child.stdout.on('data', data => {
        output += data;
        const match = output.match(/Local access: http:\/\/localhost:(\d+)/);
        if (match) { clearTimeout(deadline); resolve(Number(match[1])); }
      });
      child.on('error', error => { clearTimeout(deadline); reject(error); });
      child.on('exit', code => { clearTimeout(deadline); reject(new Error(`SQLite process exited before startup: ${code}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.engine, 'sqlite');
    assert.equal(health.db, true);
    const homepage = await fetch(base);
    assert.equal(homepage.status, 200);
    assert.equal(homepage.url, `${base}/dashboard`);
    assert.match(await homepage.text(), /\/static\/js\/main/);
    assert.equal((await fetch(`${base}/sale-entry`)).status, 200);
    const created = await fetch(`${base}/api/customers`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Desktop SQLite launch', oldBalance: 25 }) });
    assert.equal(created.status, 201);
    const customer = await created.json();
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    store = new SQLiteStore(filename);
    assert.equal((await store.namespace().collection('customers').findOne({ _id: customer._id })).oldBalance, 25);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => child.once('exit', resolve));
    }
    if (store?.open) await store.close();
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('market-sqlite-launch-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
