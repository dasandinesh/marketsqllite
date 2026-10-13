const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { InstallerUpdates } = require('../updates');
const { DesktopPreferences } = require('../../back/updates/desktop-service');
const root = path.resolve(__dirname, '../..');
function fixture() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'market-desktop-update-test-'));
  const previous = process.env.MARKET_UPDATE_DATA_DIR;
  process.env.MARKET_UPDATE_DATA_DIR = path.join(data, '.market-updates');
  return { data, cleanup() {
    if (previous === undefined) delete process.env.MARKET_UPDATE_DATA_DIR; else process.env.MARKET_UPDATE_DATA_DIR = previous;
    assert.equal(path.dirname(data), os.tmpdir()); assert.ok(path.basename(data).startsWith('market-desktop-update-test-'));
    fs.rmSync(data, { recursive: true, force: true });
  } };
}
const release = { repository: 'https://github.com/dasandinesh/marketsqllite', commit: 'a'.repeat(40), name: 'Market 1.4.0',
  manifest: { application: 'market-billing', protocol: 1, version: '1.4.0', databaseSchema: 1, minimumNodeMajor: 24 } };

test('packaged updates pin the checked revision, download an installer and confirm backup before activation', async () => {
  const temporary = fixture(); const installer = path.join(temporary.data, 'installer.exe');
  fs.writeFileSync(installer, 'test-only installer');
  let activations = 0;
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => ({ updateInfo: { version: '1.4.0' } });
  updater.downloadUpdate = async () => { updater.emit('download-progress', { percent: 50 }); return [installer]; };
  const manager = new InstallerUpdates({ root, data: temporary.data, version: '1.3.0', packaged: true,
    getLatest: async () => release, createUpdater: () => updater,
    activate: async job => {
      assert.equal(manager.job().phase, 'backing-up'); activations += 1;
      manager.files.updateJob(root, job.id, { backupCreated: true, phase: 'restarting' });
      manager.files.writeJSON(manager.pendingFile, { id: job.id, from: '1.3.0', to: '1.4.0' });
    } });
  try {
    assert.equal((await manager.check()).updateAvailable, true);
    assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false);
    assert.throws(() => manager.prepare('wrong-commit'), /Check for installer/);
    manager.prepare(release.commit); await manager.download;
    const job = manager.job(); assert.equal(job.phase, 'prepared');
    assert.throws(() => manager.save('https://github.com/other/repo'), /cancel/);
    assert.throws(() => manager.install(job.id, 'wrong-commit'), /not ready/);
    assert.equal(activations, 0);
    manager.install(job.id, release.commit);
    await new Promise(resolve => setImmediate(resolve)); await manager.installation;
    assert.equal(activations, 1); assert.equal(manager.status().job.backupCreated, true);
    const next = new InstallerUpdates({ root, data: temporary.data, version: '1.4.0', packaged: true });
    next.startupComplete(); assert.equal(next.job().phase, 'installed'); assert.equal(next.pending(), null);
  } finally { temporary.cleanup(); }
});

test('mismatched release metadata and failed installer downloads leave the current app intact', async () => {
  const temporary = fixture(); const updater = new EventEmitter();
  updater.checkForUpdates = async () => ({ updateInfo: { version: '9.9.9' } });
  const manager = new InstallerUpdates({ root, data: temporary.data, version: '1.3.0', packaged: true,
    getLatest: async () => release, createUpdater: () => updater, activate: () => { throw new Error('Must never activate'); } });
  try {
    await assert.rejects(manager.check(), /matching Windows installer/);
    updater.checkForUpdates = async () => ({ updateInfo: { version: '1.4.0' } });
    updater.downloadUpdate = async () => { throw new Error('Checksum does not match'); };
    await manager.check(); manager.prepare(release.commit); await manager.download;
    assert.equal(manager.job().phase, 'failed'); assert.equal(manager.pending(), null);
    assert.equal(manager.status().installedVersion, '1.3.0');
  } finally { temporary.cleanup(); }
});

test('backend preferences use only correlated desktop IPC replies and return parent errors safely', async () => {
  const channel = new EventEmitter(); channel.connected = true;
  let sent;
  channel.send = (message, callback) => { sent = message; callback?.(); };
  const bridge = new DesktopPreferences(channel);
  const status = bridge.status();
  channel.emit('message', { type: 'desktop-preferences-result', requestId: 'wrong', result: {} });
  channel.emit('message', { type: 'desktop-preferences-result', requestId: sent.requestId, result: { packaged: true } });
  assert.deepEqual(await status, { packaged: true });
  const install = bridge.install('job', 'commit');
  assert.deepEqual(sent.args, ['job', 'commit']);
  channel.emit('message', { type: 'desktop-preferences-result', requestId: sent.requestId, error: 'Installer not ready', status: 409 });
  await assert.rejects(install, error => error.status === 409);
  channel.connected = false;
  await assert.rejects(bridge.check(), error => error.status === 503);
  assert.equal(bridge.pending.size, 0);
});
