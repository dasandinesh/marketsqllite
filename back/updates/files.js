const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class UpdateError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function rootDirectory() { return fs.realpathSync(process.env.MARKET_INSTALL_ROOT || path.resolve(__dirname, '../..')); }
function within(parent, ...parts) {
  const target = path.resolve(parent, ...parts);
  const relative = path.relative(parent, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new UpdateError('Invalid update file location.');
  return target;
}
function updateDirectory(root) { return process.env.MARKET_UPDATE_DATA_DIR ? path.resolve(process.env.MARKET_UPDATE_DATA_DIR) : within(root, '.market-updates'); }
function readJSON(filename, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new UpdateError('An update settings file is invalid.', 500); }
}
function writeJSON(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, filename);
}
function validateManifest(manifest) {
  if (manifest?.application !== 'market-billing' || manifest.protocol !== 1 || manifest.databaseSchema !== 1
    || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(manifest.version || '') || !Number.isInteger(manifest.minimumNodeMajor) || manifest.minimumNodeMajor < 24) {
    throw new UpdateError('This repository does not contain a compatible Market desktop update. Ask the software provider to publish a compatible version.');
  }
  if (manifest.minimumNodeMajor > Number(process.versions.node.split('.')[0])) {
    throw new UpdateError(`This update needs Node.js ${manifest.minimumNodeMajor} or newer. Update Node.js before installing it.`);
  }
  return manifest;
}
function manifestAt(directory) { return validateManifest(readJSON(path.join(directory, 'market-update.json'))); }
function newer(next, current) {
  const a = next.split('.').map(Number); const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
function jobPath(root, id) {
  if (!/^[a-f0-9]{32}$/.test(id || '')) throw new UpdateError('Invalid update identifier.');
  return within(updateDirectory(root), 'jobs', id, 'job.json');
}
function updateJob(root, id, changes) {
  const filename = jobPath(root, id);
  const job = readJSON(filename);
  if (!job) throw new UpdateError('Update no longer exists.', 404);
  const next = { ...job, ...changes, updatedAt: new Date().toISOString() };
  writeJSON(filename, next);
  return next;
}
function statePath(root) { return within(updateDirectory(root), 'active.json'); }
function releasePath(root, relative) {
  if (!/^releases\/[a-f0-9]{32}$/.test(relative || '')) throw new UpdateError('Invalid release location.');
  return within(updateDirectory(root), relative);
}
module.exports = { UpdateError, rootDirectory, within, updateDirectory, readJSON, writeJSON,
  validateManifest, manifestAt, newer, jobPath, updateJob, statePath, releasePath };
