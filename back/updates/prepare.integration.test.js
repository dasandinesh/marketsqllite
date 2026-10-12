const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const zlib = require('node:zlib');
const files = require('./files');
const { prepare } = require('./installer');

// Explicit opt-in: install/build this workspace in a disposable release folder.
test('real dependency install, frontend build and isolated startup prepare a working update', {
  skip: process.env.RUN_UPDATE_BUILD_INTEGRATION !== '1', timeout: 600000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'market-update-build-test-'));
  const sourceRoot = path.resolve(__dirname, '../..');
  const id = 'f'.repeat(32);
  try {
    const filenames = execFileSync(process.env.MARKET_TEST_GIT_EXE || 'git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: sourceRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
    const local = []; const central = []; let offset = 0; let count = 0;
    for (const relative of filenames) {
      if (/(?:^|\/)(?:\.npmrc|\.env(?:\..*)?)$|\.env$|\.(db|sqlite(?:3)?|key|pem)(?:-wal|-shm)?$/.test(relative)) continue;
      const source = path.join(sourceRoot, relative); if (!fs.statSync(source).isFile()) continue;
      const name = Buffer.from(`market-preview/${relative}`); const data = fs.readFileSync(source); const crc = zlib.crc32(data);
      const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
      header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
      local.push(header, name, data);
      const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x0314, 4); record.writeUInt16LE(20, 6);
      record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(name.length, 28);
      record.writeUInt32LE((0o100600 << 16) >>> 0, 38); record.writeUInt32LE(offset, 42); central.push(record, name);
      offset += header.length + name.length + data.length; count += 1;
    }
    const directory = Buffer.concat(central); const footer = Buffer.alloc(22); footer.writeUInt32LE(0x06054b50);
    footer.writeUInt16LE(count, 8); footer.writeUInt16LE(count, 10); footer.writeUInt32LE(directory.length, 12); footer.writeUInt32LE(offset, 16);
    const archive = path.join(root, 'fixture.zip'); fs.writeFileSync(archive, Buffer.concat([...local, directory, footer]));
    const manifest = files.manifestAt(sourceRoot);
    files.writeJSON(files.jobPath(root, id), { id, phase: 'queued', source: { repository: 'https://github.com/dasandinesh/marketsqllite', commit: 'a'.repeat(40), manifest } });
    await prepare(root, id, { download: async (source, destination) => fs.copyFileSync(archive, destination) });
    assert.equal(files.readJSON(files.jobPath(root, id)).phase, 'prepared');
    assert.ok(fs.existsSync(path.join(files.releasePath(root, `releases/${id}`), 'fornt/build/index.html')));
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('market-update-build-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
