const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const storage = require('../storage');
const github = require('./github');
const files = require('./files');
const BUSY = new Set(['queued', 'downloading', 'building', 'testing', 'prepared', 'backing-up', 'restarting']);

class PreferencesService {
  constructor({ root = files.rootDirectory(), getLatest = github.latest, startWorker, managed = () => process.env.MARKET_UPDATE_MANAGED === '1' && Boolean(process.send),
    send = message => process.send(message) } = {}) {
    this.root = root; this.getLatest = getLatest; this.managed = managed; this.send = send;
    this.filename = path.join(process.env.PREFERENCES_DIR || path.join(root, 'back/.preferences'), 'software.json');
    this.startWorker = startWorker || (job => {
      const logFile = path.join(path.dirname(files.jobPath(root, job.id)), 'prepare.log');
      const descriptor = fs.openSync(logFile, 'a', 0o600);
      try {
        const child = spawn(process.execPath, [path.join(root, 'back/updates/installer.js'), root, job.id], {
          detached: true, windowsHide: true, stdio: ['ignore', descriptor, descriptor],
          env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1', npm_config_strict_ssl: 'true' },
        });
        files.updateJob(root, job.id, { workerPid: child.pid });
        child.on('error', () => files.updateJob(root, job.id, { phase: 'failed', message: 'Could not start the update preparation process.' }));
        child.unref();
      } finally { fs.closeSync(descriptor); }
    });
  }
  settings() { return files.readJSON(this.filename, { repository: 'https://github.com/dasandinesh/marketsqllite', checked: null, jobId: null }); }
  job(settings = this.settings()) {
    const job = settings.jobId ? files.readJSON(files.jobPath(this.root, settings.jobId)) : null;
    if (job && ['queued', 'downloading', 'building', 'testing'].includes(job.phase) && job.workerPid) {
      try { process.kill(job.workerPid, 0); }
      catch (error) {
        if (error.code === 'ESRCH') {
          const current = files.readJSON(files.jobPath(this.root, job.id));
          if (!['queued', 'downloading', 'building', 'testing'].includes(current?.phase)) return current;
          return files.updateJob(this.root, job.id, { phase: 'failed', message: 'Update preparation was interrupted. The current app was kept; check and prepare the update again.' });
        }
      }
    }
    return job;
  }
  status() {
    const settings = this.settings(); const job = this.job(settings);
    const manifest = files.readJSON(path.resolve(__dirname, '../../market-update.json'), { version: require('../package.json').version });
    const installedVersion = process.env.MARKET_RUNNING_VERSION || manifest.version;
    return { repository: settings.repository, engine: storage.engine(), installedVersion,
      installedCommit: process.env.MARKET_RUNNING_COMMIT || null,
      managed: this.managed(), canInstall: storage.engine() === 'sqlite' && this.managed(),
      checkedAt: settings.checkedAt || null, latest: settings.checked || null,
      updateAvailable: Boolean(settings.checked && files.newer(settings.checked.manifest.version, installedVersion)),
      job: job ? { id: job.id, phase: job.phase, version: job.source.manifest.version, commit: job.source.commit, message: job.message,
        updatedAt: job.updatedAt, backupCreated: Boolean(job.backupCreated) } : null };
  }
  save(value) {
    const settings = this.settings();
    if (BUSY.has(this.job(settings)?.phase)) throw new files.UpdateError('Finish or cancel the prepared update before changing its repository.', 409);
    const repository = github.repository(value).url;
    files.writeJSON(this.filename, { ...settings, repository, checked: null, checkedAt: null });
    return this.status();
  }
  async check() {
    const settings = this.settings();
    const checked = await this.getLatest(github.repository(settings.repository));
    // A repository edit while this request was in flight must invalidate its result.
    if (this.settings().repository !== settings.repository) throw new files.UpdateError('Repository changed. Check for updates again.', 409);
    files.writeJSON(this.filename, { ...this.settings(), checked, checkedAt: new Date().toISOString() });
    return this.status();
  }
  prepare(commit) {
    const settings = this.settings(); const status = this.status();
    if (!status.canInstall) throw new files.UpdateError('Start the SQLite desktop app using npm run start:sqlite to enable updates.', 409);
    if (BUSY.has(this.job(settings)?.phase)) throw new files.UpdateError('An update is already being prepared or installed.', 409);
    if (!status.updateAvailable || commit !== settings.checked?.commit) throw new files.UpdateError('Check for updates again before preparing this version.', 409);
    const id = crypto.randomBytes(16).toString('hex');
    const job = { id, phase: 'queued', source: settings.checked, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      message: 'Preparing a separate copy. You can continue using the current app.' };
    files.writeJSON(files.jobPath(this.root, id), job);
    files.writeJSON(this.filename, { ...settings, jobId: id });
    try { this.startWorker(job); }
    catch { files.updateJob(this.root, id, { phase: 'failed', message: 'Could not start preparing the update. The current app was kept.' }); }
    return this.status();
  }
  install(id, commit) {
    const job = this.job();
    if (!this.status().canInstall || job?.id !== id || job.phase !== 'prepared' || job.source.commit !== commit) {
      throw new files.UpdateError('This update is not ready to install. Refresh its status.', 409);
    }
    files.updateJob(this.root, id, { phase: 'backing-up', message: 'Pausing billing and sync, then backing up the database.' });
    setImmediate(() => this.send({ type: 'install-update', id }));
    return this.status();
  }
  cancel(id) {
    const job = this.job();
    if (job?.id !== id || job.phase !== 'prepared') throw new files.UpdateError('Only a prepared update can be cancelled.', 409);
    files.updateJob(this.root, id, { phase: 'cancelled', message: 'Update cancelled. The current app was kept.' });
    return this.status();
  }
}
module.exports = { PreferencesService, service: new PreferencesService() };
