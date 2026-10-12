const fs = require('node:fs');
const path = require('node:path');
const files = require('./files');
const archive = require('./archive');
const processes = require('./process');

async function smokeUpdate(directory, job, temporary) {
  const configuration = path.join(temporary, 'smoke.env'); fs.writeFileSync(configuration, '');
  const child = processes.childApp(directory, { ...process.env, DB_LOCAL_URL: '', DB_ENGINE: 'sqlite', PORT: '0', HOST: '127.0.0.1',
    SQLITE_FILE: path.join(temporary, 'smoke.sqlite'), MARKET_CONFIG_FILE: configuration, MARKET_INSTALL_ROOT: directory,
    MARKET_UPDATE_MANAGED: '0', MARKET_UPDATE_STARTING: '1', MARKET_RUNNING_VERSION: job.source.manifest.version,
    MARKET_RUNNING_COMMIT: job.source.commit, PREFERENCES_DIR: path.join(temporary, 'smoke-preferences'),
    ATLAS_SYNC_DATA_DIR: path.join(temporary, 'smoke-atlas'), ATLAS_SYNC_ADMIN_TOKEN: '' });
  try {
    const ready = await processes.healthy(child, job.source.manifest.version);
    const response = await fetch(`http://127.0.0.1:${ready.port}/api/preferences`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok || (await response.json()).installedVersion !== job.source.manifest.version) throw new Error('The new Preferences API is unavailable.');
  } finally { await processes.stopChild(child); }
}

async function prepare(root, id, { download = archive.download, extract = archive.extract, npm = processes.npm, smoke } = {}) {
  const filename = files.jobPath(root, id);
  const job = files.readJSON(filename);
  if (job?.phase !== 'queued') throw new Error('This update cannot be prepared.');
  const release = `releases/${id}`;
  const directory = files.releasePath(root, release);
  fs.mkdirSync(directory, { recursive: true });
  const zip = path.join(path.dirname(filename), 'source.zip');
  try {
    if (fs.statfsSync(root).bavail * fs.statfsSync(root).bsize < 1024 * 1024 * 1024) throw new Error('At least 1 GB of free disk space is required to prepare an update.');
    files.updateJob(root, id, { phase: 'downloading', message: 'Downloading the selected version from GitHub.' });
    await download(job.source, zip);
    await extract(zip, directory);
    const manifest = files.manifestAt(directory);
    if (JSON.stringify(manifest) !== JSON.stringify(job.source.manifest)) throw new Error('The downloaded version does not match the checked update.');
    for (const relative of ['back/package.json', 'back/package-lock.json', 'back/sqlite-server.js', 'back/desktop-launcher.js',
      'fornt/package.json', 'fornt/package-lock.json', 'fornt/src/components/preferences/Preferences.js']) {
      if (!fs.statSync(files.within(directory, relative)).isFile()) throw new Error('The downloaded update is incomplete.');
    }
    files.updateJob(root, id, { phase: 'building', message: 'Installing dependencies and building the new version. Current billing remains available.' });
    await npm(path.join(directory, 'back'), ['ci', '--no-audit', '--no-fund']);
    await npm(path.join(directory, 'fornt'), ['ci', '--no-audit', '--no-fund']);
    await npm(path.join(directory, 'fornt'), ['run', 'build']);
    if (!fs.existsSync(path.join(directory, 'fornt/build/index.html'))) throw new Error('The frontend build is missing.');
    files.updateJob(root, id, { phase: 'testing', message: 'Checking startup with a separate test database.' });
    if (smoke) await smoke(directory, job);
    else await smokeUpdate(directory, job, path.dirname(filename));
    files.updateJob(root, id, { phase: 'prepared', release, message: 'Update prepared and checked. Save unfinished bills, then install and restart.' });
  } catch (error) {
    console.error(error.message);
    files.updateJob(root, id, { phase: 'failed', message: 'Preparation failed. Your running app and database were kept. Check internet, disk space and the update preparation log.' });
    throw error;
  } finally { if (fs.existsSync(zip)) fs.unlinkSync(zip); }
}
module.exports = { prepare, smokeUpdate };
if (require.main === module) prepare(fs.realpathSync(process.argv[2]), process.argv[3]).catch(() => { process.exitCode = 1; });
