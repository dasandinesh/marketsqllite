process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { BackendRuntime } = require('./runtime');
const { InstallerUpdates } = require('./updates');
app.setName('Market Billing');
const smoke = app.commandLine.hasSwitch('smoke-test');
const customData = process.env.MARKET_DESKTOP_USER_DATA;
if (smoke && (!customData || path.dirname(path.resolve(customData)) !== os.tmpdir() || !path.basename(customData).startsWith('market-desktop-smoke-'))) {
  throw new Error('Smoke tests require a separate temporary data directory.');
}
const data = customData ? path.resolve(customData) : path.join(app.getPath('appData'), 'Market Billing');
app.setPath('userData', data);
fs.mkdirSync(data, { recursive: true });
const log = message => fs.appendFileSync(path.join(data, 'desktop.log'), `${new Date().toISOString()} ${message}`, { mode: 0o600 });
const root = app.isPackaged ? path.join(process.resourcesPath, 'app-code') : path.join(__dirname, 'staging/app-code');
const node = app.isPackaged ? path.join(process.resourcesPath, 'runtime/node.exe') : path.join(__dirname, 'staging/runtime/node.exe');
process.env.MARKET_UPDATE_DATA_DIR = path.join(data, '.market-updates');
let window; let runtime; let updates; let exiting = false; let stopping = false; let recoveringInstaller = false;
function openExternal(url) { if (/^https:\/\//i.test(url)) void shell.openExternal(url); }
function configureWindow(target) {
  target.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url.startsWith(`blob:${runtime.url}/`)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } } };
    }
    openExternal(url); return { action: 'deny' };
  });
  target.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${runtime.url}/`) && url !== 'about:blank' && !url.startsWith(`blob:${runtime.url}/`)) {
      event.preventDefault(); openExternal(url);
    }
  });
  target.webContents.on('did-create-window', child => configureWindow(child));
}
function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Preferences', click: () => window?.loadURL(`${runtime.url}/preferences`) },
      { label: 'Open data folder', click: () => shell.openPath(data) }, { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [{ label: 'About Market Billing', click: () => dialog.showMessageBox(window, {
      type: 'info', title: 'Market Billing', message: `Market Billing ${app.getVersion()}`, detail: `SQLite desktop edition\nData: ${data}` }) }] },
  ]));
}
async function recoverInstaller(error) {
  if (recoveringInstaller) return;
  recoveringInstaller = true;
  try {
    log(`Installer could not start: ${error.message}\n`);
    await runtime.stop();
    if (updates.pending()) fs.unlinkSync(updates.pendingFile);
    await runtime.start(false);
    if (window && !window.isDestroyed()) { await window.loadURL(`${runtime.url}/preferences`); if (!smoke) window.show(); }
    const job = updates.job();
    if (job) updates.files.updateJob(root, job.id, { phase: 'failed', message: 'The installer could not start. The current app resumed and the database backup was kept.' });
  } finally { recoveringInstaller = false; }
}
async function activate(job, updater) {
  let stopped = false;
  try {
    const backup = await runtime.backup(job.id);
    updates.files.updateJob(root, job.id, { backupCreated: true, previousVersion: app.getVersion(), phase: 'restarting', message: 'Database backed up. Installing the desktop update.' });
    updates.files.writeJSON(updates.pendingFile, { id: job.id, from: app.getVersion(), to: job.source.manifest.version, backup });
    await runtime.stop(); stopped = true;
    updater.once('error', error => { void recoverInstaller(error).catch(fatal); });
    updater.quitAndInstall(false, true);
  } catch (error) {
    if (stopped) await recoverInstaller(error); else runtime.resume();
    throw error;
  }
}
function fatal(error) {
  log(`Error: ${error.stack || error.message}\n`);
  if (!smoke) dialog.showErrorBox('Market Billing could not start', `${error.message}\n\nYour local data is stored at:\n${data}\n\nDetails are in desktop.log.`);
  app.exit(1);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('before-quit', event => {
    if (exiting) return;
    event.preventDefault();
    if (stopping) return;
    stopping = true;
    Promise.resolve(runtime?.stop()).finally(() => { exiting = true; app.quit(); });
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    updates = new InstallerUpdates({ root, data, version: app.getVersion(), packaged: app.isPackaged, log, activate,
      createUpdater: repo => new (require('electron-updater').NsisUpdater)({ provider: 'github', owner: repo.owner, repo: repo.name, private: false, releaseType: 'release' }) });
    runtime = new BackendRuntime({ root, node, data, log, onRequest: (action, args) => updates.request(action, args),
      onCrash: message => fatal(new Error(message)) });
    const pending = updates.pending();
    try {
      await runtime.start(Boolean(pending));
    } catch (error) {
      await runtime.stop();
      if (pending?.backup) {
        const job = updates.job();
        const expected = job ? path.join(path.dirname(updates.files.jobPath(root, job.id)), 'database.sqlite') : null;
        if (path.resolve(pending.backup) !== expected) throw new Error('The update recovery backup path is invalid.');
        require(path.join(root, 'back/updates/launcher')).restoreDatabase(expected, runtime.database);
        log(`New app startup failed; restored the pre-update database backup. Reinstall the previous desktop version.\n`);
      }
      throw error;
    }
    updates.startupComplete(); runtime.resume();
    window = new BrowserWindow({ title: 'Market Billing', width: 1440, height: 940, minWidth: 800, minHeight: 600, show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    configureWindow(window); menu();
    if (smoke) window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      callback({ cancel: !details.url.startsWith(`${runtime.url}/`) });
    });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({ title: 'Save Market file', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
    });
    await window.loadURL(`${runtime.url}/dashboard`);
    if (smoke) {
      try {
        const report = await require('./smoke-check').run({ window, runtime, updates, root, data });
        fs.writeFileSync(path.join(data, 'smoke-result.json'), JSON.stringify(report, null, 2));
        await runtime.stop(); exiting = true; app.exit(0);
      } catch (error) { await runtime.stop(); throw error; }
    } else { window.maximize(); window.show(); }
  }).catch(fatal);
}
