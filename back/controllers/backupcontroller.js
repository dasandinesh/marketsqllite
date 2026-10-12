const storage = require('../storage');
const { EJSON } = require('bson');

const SYSTEM_PREFIX = 'system.';

// Full application backup — every collection in the connected database, dumped as
// Extended JSON (EJSON) so ObjectId/Date/etc. round-trip exactly through a
// download + later restore, instead of degrading into plain strings via JSON.stringify.
exports.downloadBackup = async (req, res) => {
  try {
    const db = storage.localDb();
    if (!db) return res.status(503).json({ error: 'Database is not connected.' });

    const dump = storage.engine() === 'sqlite' ? await require('../storage/sqlite').getStore().exportBusiness() : {};
    if (storage.engine() !== 'sqlite') {
      const collectionInfos = await db.listCollections().toArray();
      for (const { name } of collectionInfos) {
        if (name.startsWith(SYSTEM_PREFIX)) continue;
        dump[name] = await db.collection(name).find({}).toArray();
      }
    }

    const payload = {
      app: 'market-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      collections: dump,
    };

    const filename = `market-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(EJSON.stringify(payload, { relaxed: false }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Restore — replaces the contents of every collection named in the backup file with
// that file's documents (deleteMany + insertMany). Collections not mentioned in the
// backup are left untouched. Destructive for the collections it does touch; the
// frontend confirms with the user before calling this.
//
// Body must be the RAW EJSON text (route uses express.text(), not express.json()) so
// $oid / $date markers survive as real ObjectId / Date instances on insert.
exports.restoreBackup = async (req, res) => {
  try {
    const db = storage.localDb();
    if (!db) return res.status(503).json({ error: 'Database is not connected.' });

    if (typeof req.body !== 'string' || !req.body.trim()) {
      return res.status(400).json({ error: 'No backup file content received.' });
    }

    let payload;
    try {
      payload = EJSON.parse(req.body, { relaxed: false });
    } catch {
      return res.status(400).json({ error: 'That file is not valid backup JSON.' });
    }

    const collections = payload && payload.collections;
    if (!collections || typeof collections !== 'object' || !Object.keys(collections).length) {
      return res.status(400).json({ error: 'This backup file has no collections to restore.' });
    }

    const summary = [];
    if (storage.engine() === 'sqlite') {
      const allowed = new Set(require('../atlas-sync/service').COLLECTIONS);
      if (Object.entries(collections).some(([name, docs]) => !allowed.has(name) || !Array.isArray(docs))) {
        return res.status(400).json({ error: 'Backup contains unknown collections or invalid record lists. Nothing was restored.' });
      }
    }
    for (const [name, docs] of Object.entries(collections)) {
      if (!Array.isArray(docs)) continue;
      const collection = db.collection(name);
      await collection.deleteMany({});
      if (docs.length) await collection.insertMany(docs, { ordered: false });
      summary.push({ collection: name, restored: docs.length });
    }

    res.json({ message: 'Restore complete.', summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.downloadSQLite = async (req, res) => {
  if (storage.engine() !== 'sqlite') return res.status(400).json({ error: 'This download is available in SQLite mode.' });
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'market-sqlite-backup-'));
  const filename = path.join(directory, 'market.sqlite');
  const cleanup = () => {
    fs.rmSync(filename, { force: true });
    fs.rmdirSync(directory);
  };
  try {
    await require('../storage/sqlite').getStore().backup(filename);
    res.download(filename, `market-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`, () => cleanup());
  } catch {
    cleanup();
    res.status(500).json({ error: 'Could not create the SQLite database backup.' });
  }
};

module.exports = require('../storage/transaction').wrapControllers(module.exports);
