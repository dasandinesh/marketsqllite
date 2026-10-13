const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const BUSY = new Set(['downloading', 'prepared', 'backing-up', 'restarting']);

class InstallerUpdates {
  constructor({ root, data, version, packaged, createUpdater, activate, getLatest, log = () => {} }) {
    Object.assign(this, { root, data, version, packaged, createUpdater, activate, log });
    this.files = require(path.join(root, 'back/updates/files'));
    this.github = require(path.join(root, 'back/updates/github'));
    this.getLatest = getLatest || this.github.latest;
    this.filename = path.join(data, '.preferences/software.json');
    this.pendingFile = path.join(data, '.market-updates/installer-pending.json');
    this.updater = null; this.checking = false;
  }
  settings() { return this.files.readJSON(this.filename, { repository: 'https://github.com/dasandinesh/marketsqllite', checked: null, jobId: null }); }
  job() { const id = this.settings().jobId; return id ? this.files.readJSON(this.files.jobPath(this.root, id)) : null; }
  status() {
    const settings = this.settings(); const job = this.job();
    return { repository: settings.repository, engine: 'sqlite', installedVersion: this.version, installedCommit: null,
      packaged: true, managed: true, canInstall: this.packaged, checking: this.checking,
      checkedAt: settings.checkedAt || null, latest: settings.checked,
      updateAvailable: Boolean(settings.checked && this.files.newer(settings.checked.manifest.version, this.version)),
      job: job ? { id: job.id, phase: job.phase, version: job.source.manifest.version, commit: job.source.commit,
        message: job.message, updatedAt: job.updatedAt, backupCreated: Boolean(job.backupCreated) } : null };
  }
  assertIdle() { if (this.checking || BUSY.has(this.job()?.phase)) throw new this.files.UpdateError('Finish or cancel the current update first.', 409); }
  save(value) {
    this.assertIdle();
    const repository = this.github.repository(value).url;
    this.updater = null;
    this.files.writeJSON(this.filename, { ...this.settings(), repository, checked: null, checkedAt: null });
    return this.status();
  }
  async check() {
    this.assertIdle(); this.checking = true;
    try {
      const settings = this.settings();
      const repo = this.github.repository(settings.repository);
      const latest = await this.getLatest(repo);
      if (!this.packaged) throw new this.files.UpdateError('Installer updates are available after installing the packaged application.', 409);
      if (!this.files.newer(latest.manifest.version, this.version)) {
        this.updater = null;
        this.files.writeJSON(this.filename, { ...settings, checked: latest, checkedAt: new Date().toISOString() });
        return this.status();
      }
      const updater = this.createUpdater(repo);
      updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.allowDowngrade = false;
      updater.disableWebInstaller = true;
      updater.on('error', error => this.log(`Installer updater: ${error.message}\n`));
      updater.on('download-progress', progress => {
        const job = this.job();
        if (job?.phase === 'downloading') this.files.updateJob(this.root, job.id, { message: `Downloading installer: ${Math.min(100, Math.round(progress.percent))}%` });
      });
      const result = await updater.checkForUpdates();
      if (!result?.updateInfo || result.updateInfo.version !== latest.manifest.version) {
        throw new this.files.UpdateError('This repository needs a stable GitHub Release containing the matching Windows installer and latest.yml.', 409);
      }
      this.updater = updater;
      this.files.writeJSON(this.filename, { ...settings, checked: latest, checkedAt: new Date().toISOString() });
      return this.status();
    } catch (error) {
      if (error.status) throw error;
      this.log(`Update check: ${error.message}\n`);
      throw new this.files.UpdateError('Cannot check installer updates. Check internet and confirm the provider published a Windows release with latest.yml.', 502);
    } finally { this.checking = false; }
  }
  prepare(commit) {
    this.assertIdle();
    const settings = this.settings();
    if (!this.updater || !this.status().updateAvailable || commit !== settings.checked?.commit) throw new this.files.UpdateError('Check for installer updates again first.', 409);
    const id = crypto.randomBytes(16).toString('hex');
    const job = { id, phase: 'downloading', source: settings.checked, createdAt: new Date().toISOString(), message: 'Downloading the ready-made installer. Billing remains available.' };
    this.files.writeJSON(this.files.jobPath(this.root, id), job);
    this.files.writeJSON(this.filename, { ...settings, jobId: id });
    this.download = Promise.resolve().then(() => this.updater.downloadUpdate()).then(paths => {
      if (!paths?.length || !paths.every(filename => fs.existsSync(filename))) throw new Error('Downloaded installer is missing.');
      this.files.updateJob(this.root, id, { phase: 'prepared', message: 'Installer downloaded and checksum verified. Save unfinished bills, then install and restart.' });
    }).catch(error => {
      this.log(`Installer download: ${error.message}\n`);
      this.files.updateJob(this.root, id, { phase: 'failed', message: 'Installer download failed. The current app and data were kept; check your connection and try again.' });
    });
    return this.status();
  }
  install(id, commit) {
    const job = this.job();
    if (!this.packaged || !this.updater || job?.id !== id || job.phase !== 'prepared' || job.source.commit !== commit) throw new this.files.UpdateError('This installer is not ready. Check and download it again.', 409);
    this.files.updateJob(this.root, id, { phase: 'backing-up', message: 'Pausing billing and sync, and backing up your database.' });
    setImmediate(() => {
      this.installation = Promise.resolve().then(() => this.activate(job, this.updater)).catch(error => {
        this.log(`Installer activation: ${error.message}\n`);
        this.files.updateJob(this.root, id, { phase: 'failed', message: 'Installation could not start. Your database backup was retained; restart the app and check the log.' });
      });
    });
    return this.status();
  }
  cancel(id) {
    const job = this.job();
    if (job?.id !== id || job.phase !== 'prepared') throw new this.files.UpdateError('Only a downloaded installer can be cancelled.', 409);
    this.files.updateJob(this.root, id, { phase: 'cancelled', message: 'Update cancelled. The current app was kept.' });
    return this.status();
  }
  pending() { return this.files.readJSON(this.pendingFile); }
  startupComplete() {
    const pending = this.pending(); const job = this.job();
    if (pending && job?.id === pending.id) {
      this.files.updateJob(this.root, job.id, { phase: this.version === pending.to || this.files.newer(this.version, pending.to) ? 'installed' : 'failed',
        message: this.version === pending.from ? 'Installer activation was interrupted. The previous version and your data were kept.' : 'Desktop application started successfully. Your data and settings were retained.' });
    } else if (job && ['downloading', 'prepared', 'backing-up', 'restarting'].includes(job.phase)) {
      this.files.updateJob(this.root, job.id, { phase: 'failed', message: 'The pending update was interrupted. Check and download it again; the installed app was kept.' });
    }
    if (pending) fs.unlinkSync(this.pendingFile);
  }
  async request(action, args) {
    if (!['status', 'save', 'check', 'prepare', 'install', 'cancel'].includes(action) || !Array.isArray(args) || args.length > 2) throw new this.files.UpdateError('Invalid desktop settings action.');
    return this[action](...args);
  }
}
module.exports = { InstallerUpdates };
