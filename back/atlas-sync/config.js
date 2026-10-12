const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function validateConnection(uri, database) {
  if (typeof uri !== 'string' || uri.length > 4096) throw new Error('Enter an Atlas connection string.');
  let parsed;
  try { parsed = new URL(uri.trim()); } catch { throw new Error('Enter a valid Atlas connection string.'); }
  if (parsed.protocol !== 'mongodb+srv:' || !/^[a-z0-9.-]+\.mongodb\.net$/i.test(parsed.hostname)
    || parsed.port || parsed.hash || !parsed.username || !parsed.password) {
    throw new Error('Use an Atlas mongodb+srv:// connection string with a database username and password.');
  }
  const allowed = new Set(['retrywrites', 'w', 'appname', 'authsource', 'authmechanism', 'tls', 'ssl', 'readpreference']);
  const seen = new Set();
  for (const [key, value] of parsed.searchParams) {
    const option = key.toLowerCase();
    if (!allowed.has(option) || seen.has(option)) throw new Error(`Unsupported connection option: ${key}.`);
    seen.add(option);
    if ((option === 'tls' || option === 'ssl') && value !== 'true') throw new Error('Atlas requires verified TLS.');
    if (option === 'readpreference' && value !== 'primary') throw new Error('Sync requires primary reads.');
    if (option === 'w' && value !== 'majority') throw new Error('Sync requires majority writes.');
    if (option === 'authmechanism' && !['SCRAM-SHA-1', 'SCRAM-SHA-256'].includes(value)) {
      throw new Error('Use password authentication for this Atlas connection.');
    }
  }
  if (typeof database !== 'string' || !/^[a-zA-Z0-9_-]{1,63}$/.test(database)
    || ['admin', 'local', 'config'].includes(database.toLowerCase())) {
    throw new Error('Enter a database name (letters, numbers, underscores or hyphens; up to 63 characters).');
  }
  return { uri: uri.trim(), database, host: parsed.hostname.toLowerCase() };
}

class ConfigStore {
  constructor(directory = process.env.ATLAS_SYNC_DATA_DIR || path.join(__dirname,
    require('../storage').engine() === 'sqlite' ? '../.atlas-sync-sqlite' : '../.atlas-sync')) {
    this.directory = directory;
    this.filename = path.join(directory, 'connection.json');
  }

  key() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const filename = path.join(this.directory, 'encryption.key');
    try { fs.writeFileSync(filename, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const key = fs.readFileSync(filename);
    if (key.length !== 32) throw new Error('Atlas encryption key is invalid. Restore the original key.');
    return key;
  }

  read() {
    if (!fs.existsSync(this.filename)) return null;
    const stored = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), Buffer.from(stored.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    const uri = Buffer.concat([decipher.update(Buffer.from(stored.encryptedUri, 'base64')), decipher.final()]).toString();
    return { ...validateConnection(uri, stored.database), enabled: stored.enabled === true };
  }

  write(config) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(), iv);
    const encryptedUri = Buffer.concat([cipher.update(config.uri, 'utf8'), cipher.final()]).toString('base64');
    const stored = { database: config.database, enabled: config.enabled === true, encryptedUri,
      iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
    const temporary = `${this.filename}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(stored), { mode: 0o600 });
    fs.renameSync(temporary, this.filename);
  }

  remove() { fs.rmSync(this.filename, { force: true }); }
}

module.exports = { ConfigStore, validateConnection };
