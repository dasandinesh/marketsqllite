const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const files = require('./files');
const github = require('./github');
const { PreferencesService } = require('./service');
const { extract } = require('./archive');
const { prepare } = require('./installer');

const manifest = { application: 'market-billing', protocol: 1, version: '2.0.0', databaseSchema: 1, minimumNodeMajor: 24 };
function zip(entries) {
  const local = []; const central = []; let offset = 0;
  for (const [name, contents, mode = 0o100600] of entries) {
    const filename = Buffer.from(name); const data = Buffer.from(contents); const crc = zlib.crc32(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x0314, 4); record.writeUInt16LE(20, 6);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE((mode << 16) >>> 0, 38); record.writeUInt32LE(offset, 42); central.push(record, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central); const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50); footer.writeUInt16LE(entries.length, 8); footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(directory.length, 12); footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, footer]);
}
async function temporary(operation) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'market-update-test-'));
  try { await operation(directory); }
  finally { assert.equal(path.dirname(directory), os.tmpdir()); assert.ok(path.basename(directory).startsWith('market-update-test-')); fs.rmSync(directory, { recursive: true, force: true }); }
}

test('repository and manifest validation reject credentials, non-GitHub targets and incompatible schema changes', () => {
  assert.equal(github.repository('https://github.com/vendor/market.git').url, 'https://github.com/vendor/market');
  for (const url of ['http://github.com/vendor/market', 'https://user:password@github.com/vendor/market', 'https://github.com.evil.test/vendor/market',
    'https://github.com/vendor/market/tree/main', 'https://github.com/vendor/market?token=private']) assert.throws(() => github.repository(url));
  assert.throws(() => files.validateManifest({ ...manifest, databaseSchema: 2 }), /compatible/);
  assert.throws(() => files.validateManifest({ ...manifest, minimumNodeMajor: 999 }), /Node.js/);
  assert.throws(() => files.within('C:/example', '../escape'));
});

test('GitHub updates resolve a release tag to a pinned commit and validate its manifest', async () => {
  const requested = []; const commit = 'a'.repeat(40);
  const result = await github.latest(github.repository('https://github.com/vendor/market'), async url => {
    requested.push(url);
    if (url.endsWith('/releases/latest')) return { tag_name: 'v2.0.0', name: 'Market 2', body: 'Billing improvements' };
    if (url.includes('/commits/')) return { sha: commit };
    return manifest;
  });
  assert.equal(result.commit, commit);
  assert.ok(requested[2].includes(`/${commit}/market-update.json`));
  assert.equal(result.manifest.version, '2.0.0');
});

test('preferences preserve a prepared commit, reject stale install requests and cancel without overwriting code', async () => temporary(async root => {
  const previous = process.env.PREFERENCES_DIR;
  process.env.PREFERENCES_DIR = path.join(root, 'preferences');
  let sent;
  try {
    const latest = { commit: 'a'.repeat(40), manifest, repository: 'https://github.com/vendor/market' };
    const service = new PreferencesService({ root, managed: () => true, getLatest: async () => latest,
      startWorker: job => files.updateJob(root, job.id, { phase: 'prepared', release: `releases/${job.id}` }), send: value => { sent = value; } });
    const originalEngine = process.env.DB_ENGINE; process.env.DB_ENGINE = 'sqlite';
    try {
      service.save(latest.repository);
      await service.check();
      assert.throws(() => service.prepare('b'.repeat(40)), /Check for updates/);
      const prepared = service.prepare(latest.commit);
      assert.equal(prepared.job.phase, 'prepared');
      assert.throws(() => service.save('https://github.com/other/market'), /Finish or cancel/);
      assert.throws(() => service.install(prepared.job.id, 'b'.repeat(40)), /not ready/);
      service.cancel(prepared.job.id);
      assert.equal(service.status().job.phase, 'cancelled');
      const next = service.prepare(latest.commit);
      service.install(next.job.id, next.job.commit);
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(sent, { type: 'install-update', id: next.job.id });
    } finally { if (originalEngine === undefined) delete process.env.DB_ENGINE; else process.env.DB_ENGINE = originalEngine; }
  } finally { if (previous === undefined) delete process.env.PREFERENCES_DIR; else process.env.PREFERENCES_DIR = previous; }
}));

test('ZIP extraction rejects traversal and symlinks and leaves private configuration out of a release', async () => temporary(async root => {
  for (const [name, mode] of [['repo/../outside', 0o100600], ['repo/link', 0o120777]]) {
    const archive = path.join(root, `unsafe-${mode}.zip`); fs.writeFileSync(archive, zip([[name, 'bad', mode]]));
    await assert.rejects(() => extract(archive, path.join(root, 'unsafe')), /unsafe|invalid|links/i);
  }
  const archive = path.join(root, 'safe.zip');
  fs.writeFileSync(archive, zip([['repo/market-update.json', JSON.stringify(manifest)], ['repo/back/config/config.env', 'PRIVATE=value'], ['repo/back/data/market.sqlite', 'PRIVATE DATA']]));
  await extract(archive, path.join(root, 'release'));
  assert.ok(fs.existsSync(path.join(root, 'release/market-update.json')));
  assert.equal(fs.existsSync(path.join(root, 'release/back/config/config.env')), false);
  assert.equal(fs.existsSync(path.join(root, 'release/back/data/market.sqlite')), false);
}));

test('failed preparation leaves the running installation untouched', async () => temporary(async root => {
  const id = 'd'.repeat(32);
  fs.mkdirSync(path.join(root, 'back'), { recursive: true }); fs.writeFileSync(path.join(root, 'back/current.txt'), 'original');
  files.writeJSON(files.jobPath(root, id), { id, phase: 'queued', source: { commit: 'a'.repeat(40), manifest } });
  await assert.rejects(() => prepare(root, id, { download: async () => { throw new Error('Internet unavailable'); } }), /Internet unavailable/);
  assert.equal(files.readJSON(files.jobPath(root, id)).phase, 'failed');
  assert.equal(fs.readFileSync(path.join(root, 'back/current.txt'), 'utf8'), 'original');
}));

module.exports = { zip };
