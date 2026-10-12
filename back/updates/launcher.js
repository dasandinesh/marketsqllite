const fs = require('node:fs');
const path = require('node:path');
const files = require('./files');
const processes = require('./process');

function restoreDatabase(backup, database) {
  if (fs.readFileSync(backup).subarray(0, 16).toString() !== 'SQLite format 3\0') throw new Error('The recovery backup is invalid.');
  if (fs.existsSync(database) && !fs.lstatSync(database).isFile()) throw new Error('Recovery database must be a regular file.');
  const temporary = `${database}.update-restore.tmp`;
  if (fs.existsSync(temporary)) throw new Error('An unfinished database recovery file exists.');
  fs.copyFileSync(backup, temporary, fs.constants.COPYFILE_EXCL);
  for (const suffix of ['-wal', '-shm']) {
    const file = `${database}${suffix}`;
    if (fs.existsSync(file)) { if (!fs.lstatSync(file).isFile()) throw new Error('Invalid journal file.'); fs.unlinkSync(file); }
  }
  fs.renameSync(temporary, database);
}

class DesktopLauncher {
  constructor(root, env = process.env) {
    this.root = fs.realpathSync(root);
    this.baseEnv = { ...env, DB_ENGINE: 'sqlite', HOST: env.HOST || '127.0.0.1', PORT: env.PORT || '8000',
      SQLITE_FILE: path.resolve(root, 'back', env.SQLITE_FILE || 'data/market.sqlite'),
      ATLAS_SYNC_DATA_DIR: path.resolve(root, 'back', env.ATLAS_SYNC_DATA_DIR || '.atlas-sync-sqlite'),
      PREFERENCES_DIR: path.resolve(root, 'back', env.PREFERENCES_DIR || '.preferences'),
      MARKET_CONFIG_FILE: path.resolve(root, 'back', env.MARKET_CONFIG_FILE || 'config/config.env'), MARKET_INSTALL_ROOT: this.root,
      MARKET_UPDATE_MANAGED: '1' };
    if (env.SQLITE_FILE === ':memory:') throw new Error('Desktop software updates require a persistent SQLite database file.');
    if (fs.existsSync(this.baseEnv.SQLITE_FILE) && !fs.lstatSync(this.baseEnv.SQLITE_FILE).isFile()) {
      throw new Error('Desktop updates require a regular SQLite database file. Use its actual file path rather than a link.');
    }
    this.child = null; this.busy = false; this.stopping = false;
  }
  state() { return files.readJSON(files.statePath(this.root), { active: null, version: files.manifestAt(this.root).version, commit: null }); }
  async launch(state = this.state(), starting = false) {
    const directory = state.active ? files.releasePath(this.root, state.active) : this.root;
    const manifest = files.manifestAt(directory);
    const child = processes.childApp(directory, { ...this.baseEnv, MARKET_RUNNING_VERSION: manifest.version,
      MARKET_RUNNING_COMMIT: state.commit || '', MARKET_UPDATE_STARTING: starting ? '1' : '0' });
    this.child = child;
    child.on('message', message => {
      if (child === this.child && message?.type === 'install-update') void this.install(message.id).catch(error => console.error(`Update recovery needs attention: ${error.message}`));
    });
    const ready = await processes.healthy(child, manifest.version);
    this.baseEnv.PORT = String(ready.port);
    return child;
  }
  async recoverInterrupted() {
    const state = this.state();
    if (!state.pendingJob) {
      // A crash can happen after Install is requested but before recovery is recorded.
      const settings = files.readJSON(path.join(this.baseEnv.PREFERENCES_DIR, 'software.json'));
      const job = settings?.jobId ? files.readJSON(files.jobPath(this.root, settings.jobId)) : null;
      if (job && ['backing-up', 'restarting'].includes(job.phase)) {
        files.updateJob(this.root, job.id, { phase: 'failed', message: 'Installation was interrupted before activation. The current version was kept; prepare the update again.' });
      }
      return;
    }
    const job = files.readJSON(files.jobPath(this.root, state.pendingJob));
    if (!job?.previous || !job.backupCreated) throw new Error('An interrupted update needs manual recovery. See the update backup folder.');
    restoreDatabase(path.join(path.dirname(files.jobPath(this.root, job.id)), 'database.sqlite'), this.baseEnv.SQLITE_FILE);
    files.writeJSON(files.statePath(this.root), job.previous);
    files.updateJob(this.root, job.id, { phase: 'rolled-back', message: 'An interrupted update was recovered. The previous app and database were restored.' });
  }
  async install(id) {
    if (this.busy || this.stopping) return;
    this.busy = true;
    const previous = this.state();
    let stopped = false;
    try {
      const job = files.readJSON(files.jobPath(this.root, id));
      if (job?.phase !== 'backing-up' || !job.release) throw new Error('Update is not prepared.');
      const directory = files.releasePath(this.root, job.release);
      if (files.manifestAt(directory).version !== job.source.manifest.version) throw new Error('Prepared update changed.');
      const ready = processes.waitMessage(this.child, 'update-backed-up', 45000);
      this.child.send({ type: 'begin-update', id });
      await ready;
      const backup = path.join(path.dirname(files.jobPath(this.root, id)), 'database.sqlite');
      if (!fs.existsSync(backup)) throw new Error('The database backup is missing.');
      files.updateJob(this.root, id, { previous, backupCreated: true, phase: 'restarting', message: 'Restarting with the checked update.' });
      // Record recovery before stopping: a launcher crash resumes the old version.
      files.writeJSON(files.statePath(this.root), { ...previous, pendingJob: id });
      await processes.stopChild(this.child); stopped = true;
      const next = { active: job.release, version: job.source.manifest.version, commit: job.source.commit };
      files.writeJSON(files.statePath(this.root), { ...next, pendingJob: id });
      const current = await this.launch(next, true);
      files.writeJSON(files.statePath(this.root), next);
      files.updateJob(this.root, id, { phase: 'installed', message: 'Software updated successfully. Your data and settings were retained.' });
      current.send({ type: 'resume-service' });
    } catch (error) {
      console.error(`Update failed: ${error.message}`);
      if (stopped) {
        await processes.stopChild(this.child);
        const backup = path.join(path.dirname(files.jobPath(this.root, id)), 'database.sqlite');
        restoreDatabase(backup, this.baseEnv.SQLITE_FILE);
        files.writeJSON(files.statePath(this.root), previous);
        const current = await this.launch(previous, true);
        files.updateJob(this.root, id, { phase: 'rolled-back', message: 'The new version could not start. The previous app and database were restored.' });
        current.send({ type: 'resume-service' });
      } else {
        if (this.child?.connected) this.child.send({ type: 'resume-service' });
        files.updateJob(this.root, id, { phase: 'failed', message: 'Installation was stopped before replacing the app. Your current version was kept.' });
      }
    } finally { this.busy = false; }
  }
  async stop() { this.stopping = true; await processes.stopChild(this.child); }
}
module.exports = { DesktopLauncher, restoreDatabase };
