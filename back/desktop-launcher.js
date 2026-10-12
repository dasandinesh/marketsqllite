const fs = require('node:fs');
const path = require('node:path');
const files = require('./updates/files');
const { DesktopLauncher } = require('./updates/launcher');
const root = files.rootDirectory();
require('dotenv').config({ path: process.env.MARKET_CONFIG_FILE || path.join(root, 'back/config/config.env'), quiet: true });
const directory = files.updateDirectory(root);
fs.mkdirSync(directory, { recursive: true });
const lock = path.join(directory, 'launcher.lock');
if (fs.existsSync(lock)) {
  const existing = files.readJSON(lock);
  let running = true;
  try { process.kill(existing.pid, 0); } catch (error) { if (error.code === 'ESRCH') running = false; }
  if (running) throw new Error('This desktop installation is already running.');
  fs.unlinkSync(lock);
}
fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
const launcher = new DesktopLauncher(root);
const releaseLock = () => { if (files.readJSON(lock)?.pid === process.pid) fs.unlinkSync(lock); };
const stop = async () => { await launcher.stop(); releaseLock(); process.exit(0); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
if (process.send) {
  process.on('message', message => { if (message?.type === 'shutdown') void stop(); });
  process.once('disconnect', () => { void stop(); });
}
process.on('exit', releaseLock);
launcher.recoverInterrupted().then(() => launcher.launch()).catch(async error => {
  console.error(error.message); await launcher.stop(); releaseLock(); process.exitCode = 1;
});
