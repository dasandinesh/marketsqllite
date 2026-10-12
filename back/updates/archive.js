const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const yauzl = require('yauzl');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { repository } = require('./github');
const { within, UpdateError } = require('./files');

async function download(source, filename) {
  const repo = repository(source.repository);
  if (!/^[a-f0-9]{40}$/.test(source.commit)) throw new UpdateError('Invalid update revision.');
  const url = `https://codeload.github.com/${repo.owner}/${repo.name}/zip/${source.commit}`;
  const response = await new Promise((resolve, reject) => {
    const request = https.get(url, { rejectUnauthorized: true, headers: { 'User-Agent': 'Market-Desktop-Updater' } }, result => {
      if (result.statusCode === 200) resolve(result);
      else { result.resume(); reject(new UpdateError('Could not download this update.')); }
    });
    request.setTimeout(30000, () => request.destroy(new Error('Download timed out')));
    request.on('error', reject);
  });
  let total = 0;
  await pipeline(response, new Transform({ transform(chunk, encoding, callback) {
    total += chunk.length;
    callback(total > 50 * 1024 * 1024 ? new Error('Update archive exceeds 50 MB.') : null, chunk);
  } }), fs.createWriteStream(filename, { flags: 'wx' }));
}

function extract(filename, destination) {
  return new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) { reject(error); return; }
      let count = 0; let total = 0; let top;
      const names = new Set();
      const fail = failure => { zip.close(); reject(failure); };
      zip.on('error', fail);
      zip.on('end', resolve);
      zip.on('entry', async entry => {
        try {
          count += 1; total += entry.uncompressedSize;
          if (count > 20000 || total > 250 * 1024 * 1024) throw new Error('Update archive exceeds the extraction limit.');
          if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) throw new Error('Links are not allowed in update archives.');
          const parts = entry.fileName.split('/');
          if (parts.some(part => part === '..' || part === '.' || /[\\:\x00-\x1f]/.test(part)
            || /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Unsafe archive filename.');
          if (!parts[0] || (top && top !== parts[0])) throw new Error('Expected a single GitHub repository archive.');
          top = parts.shift();
          const relative = parts.join('/');
          if (!relative) { zip.readEntry(); return; }
          const normalized = relative.toLowerCase();
          if (names.has(normalized)) throw new Error('Duplicate archive filename.');
          names.add(normalized);
          if (parts.some(part => ['.git', '.market-updates', '.preferences', '.atlas-sync', '.atlas-sync-sqlite', 'node_modules'].includes(part))
            || /^back\/data\//i.test(relative) || /(?:^|\/)\.env(?:\.|$)|\.env$|\.(sqlite(?:3)?|db|key|pem)(?:-wal|-shm)?$/i.test(relative)) {
            zip.readEntry(); return;
          }
          const output = within(destination, relative);
          if (entry.fileName.endsWith('/')) fs.mkdirSync(output, { recursive: true });
          else {
            fs.mkdirSync(path.dirname(output), { recursive: true });
            const stream = await new Promise((resolveStream, rejectStream) => zip.openReadStream(entry, (err, result) => err ? rejectStream(err) : resolveStream(result)));
            await pipeline(stream, fs.createWriteStream(output, { flags: 'wx', mode: 0o600 }));
          }
          zip.readEntry();
        } catch (failure) { fail(failure); }
      });
      zip.readEntry();
    });
  });
}
module.exports = { download, extract };
