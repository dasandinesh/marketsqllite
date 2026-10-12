const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const files = require('./files');
const { stopChild } = require('./process');

test('the managed desktop entry serves preferences and keeps its database and settings in configured paths', { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'market-update-entry-test-'));
  fs.mkdirSync(path.join(root, 'back'), { recursive: true });
  files.writeJSON(path.join(root, 'market-update.json'), files.manifestAt(path.resolve(__dirname, '../..')));
  fs.writeFileSync(path.join(root, 'back/sqlite-server.js'), `require(${JSON.stringify(path.resolve(__dirname, '../sqlite-server.js'))});`);
  const config = path.join(root, 'private.env');
  fs.writeFileSync(config, '');
  const child = fork(path.resolve(__dirname, '../desktop-launcher.js'), [], { windowsHide: true,
    env: { ...process.env, MARKET_INSTALL_ROOT: root, MARKET_CONFIG_FILE: config, PORT: '0', HOST: '127.0.0.1',
      SQLITE_FILE: path.join(root, 'customer.sqlite'), PREFERENCES_DIR: path.join(root, 'preferences'),
      ATLAS_SYNC_DATA_DIR: path.join(root, 'atlas'), ATLAS_SYNC_ADMIN_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  try {
    const port = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`Managed launch timed out: ${errors}`)), 20000);
      child.stdout.on('data', data => {
        output += data;
        const match = output.match(/Local access: http:\/\/localhost:(\d+)/);
        if (match) { clearTimeout(deadline); resolve(Number(match[1])); }
      });
      child.once('error', error => { clearTimeout(deadline); reject(error); });
      child.once('exit', code => { clearTimeout(deadline); reject(new Error(`Managed launch exited: ${code} ${errors}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const status = await (await fetch(`${base}/api/preferences`)).json();
    assert.equal(status.managed, true);
    assert.equal(status.canInstall, true);
    assert.equal(status.engine, 'sqlite');
    assert.equal(status.installedVersion, files.manifestAt(root).version);
    const repository = 'https://github.com/example/market';
    assert.equal((await fetch(`${base}/api/preferences/repository`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository }) })).status, 200);
    assert.equal(files.readJSON(path.join(root, 'preferences/software.json')).repository, repository);
    assert.ok(fs.existsSync(path.join(root, 'customer.sqlite')));
    await stopChild(child);
    assert.equal(fs.existsSync(path.join(root, '.market-updates/launcher.lock')), false);
    assert.equal(fs.readFileSync(config, 'utf8'), '');
  } finally {
    await stopChild(child);
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('market-update-entry-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
