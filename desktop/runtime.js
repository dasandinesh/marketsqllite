const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');

class BackendRuntime {
  constructor({ root, node, data, log, onRequest, onCrash }) {
    Object.assign(this, { root, node, data, log, onRequest, onCrash });
    this.processes = require(path.join(root, 'back/updates/process'));
    this.files = require(path.join(root, 'back/updates/files'));
    this.database = path.join(data, 'data/market.sqlite');
    this.child = null; this.stopping = false; this.url = null;
    fs.mkdirSync(data, { recursive: true });
    const config = path.join(data, 'config.env');
    if (!fs.existsSync(config)) fs.writeFileSync(config, 'NODE_ENV=production\nDB_ENGINE=sqlite\n', { flag: 'wx', mode: 0o600 });
    this.env = { ...process.env, NODE_ENV: 'production', NODE_TLS_REJECT_UNAUTHORIZED: '1',
      DB_ENGINE: 'sqlite', DB_LOCAL_URL: '', HOST: '127.0.0.1', PORT: '0', SQLITE_FILE: this.database,
      MARKET_CONFIG_FILE: config, MARKET_INSTALL_ROOT: root, MARKET_RUNNING_VERSION: require(path.join(root, 'market-update.json')).version,
      MARKET_RUNNING_COMMIT: '', MARKET_DESKTOP: '1', MARKET_UPDATE_MANAGED: '0',
      MARKET_UPDATE_DATA_DIR: path.join(data, '.market-updates'), PREFERENCES_DIR: path.join(data, '.preferences'),
      ATLAS_SYNC_DATA_DIR: path.join(data, '.atlas-sync-sqlite') };
    delete this.env.NODE_OPTIONS;
    delete this.env.ATLAS_SYNC_ADMIN_TOKEN;
  }
  async start(maintenance = false) {
    this.stopping = false;
    const child = fork(path.join(this.root, 'back/sqlite-server.js'), [], { execPath: this.node, execArgv: [],
      cwd: path.join(this.root, 'back'), windowsHide: true, env: { ...this.env, MARKET_UPDATE_STARTING: maintenance ? '1' : '0' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    this.child = child;
    child.stdout.on('data', data => this.log(String(data)));
    child.stderr.on('data', data => this.log(String(data)));
    child.on('message', message => {
      if (message?.type !== 'desktop-preferences' || !/^[a-f0-9]{32}$/.test(message.requestId || '')) return;
      Promise.resolve().then(() => this.onRequest(message.action, message.args)).then(result => {
        if (child.connected) child.send({ type: 'desktop-preferences-result', requestId: message.requestId, result }, () => {});
      }, error => {
        this.log(`Preferences: ${error.message}\n`);
        if (child.connected) child.send({ type: 'desktop-preferences-result', requestId: message.requestId,
          error: error.status ? error.message : 'Desktop settings are unavailable. Check the application log.', status: error.status || 500 }, () => {});
      });
    });
    let ready = false;
    child.once('exit', (code, signal) => { if (ready && !this.stopping) this.onCrash?.(`The local billing service stopped (${signal || code}).`); });
    const health = await this.processes.healthy(child, this.env.MARKET_RUNNING_VERSION);
    this.url = `http://127.0.0.1:${health.port}`; ready = true;
    return this.url;
  }
  async backup(id) {
    if (!this.child?.connected) throw new Error('The billing service is unavailable.');
    const complete = this.processes.waitMessage(this.child, 'update-backed-up', 45000);
    this.child.send({ type: 'begin-update', id });
    await complete;
    const backup = path.join(path.dirname(this.files.jobPath(this.root, id)), 'database.sqlite');
    if (!fs.existsSync(backup)) throw new Error('The database recovery backup was not created.');
    return backup;
  }
  resume() { if (this.child?.connected) this.child.send({ type: 'resume-service' }, () => {}); }
  async stop() { this.stopping = true; await this.processes.stopChild(this.child); }
}
module.exports = { BackendRuntime };
