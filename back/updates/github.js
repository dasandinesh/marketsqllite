const https = require('node:https');
const { UpdateError, validateManifest } = require('./files');

function repository(value) {
  let url;
  try { url = new URL(value); } catch { throw new UpdateError('Enter a public GitHub repository URL.'); }
  const parts = url.pathname.replace(/\/$/, '').replace(/\.git$/, '').split('/').filter(Boolean);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password
    || url.search || url.hash || parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part) || part === '..')) {
    throw new UpdateError('Use https://github.com/owner/repository without passwords, query parameters or extra paths.');
  }
  return { owner: parts[0], name: parts[1], url: `https://github.com/${parts.join('/')}` };
}
function json(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { rejectUnauthorized: true, headers: {
      'User-Agent': 'Market-Desktop-Updater', Accept: 'application/vnd.github+json', 'Accept-Encoding': 'identity',
    } }, response => {
      if (response.statusCode === 404) { response.resume(); resolve(null); return; }
      if (response.statusCode !== 200) {
        response.resume(); reject(new UpdateError(response.statusCode === 403 || response.statusCode === 429
          ? 'GitHub limited update checks. Try again later.' : 'GitHub could not provide this update. Check the repository link and internet connection.', 502)); return;
      }
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) request.destroy(new Error('Response too large')); else chunks.push(chunk); });
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new UpdateError('The repository update information is invalid.', 502)); } });
      response.on('error', reject);
    });
    request.setTimeout(20000, () => request.destroy(new Error('Timed out')));
    request.on('error', () => reject(new UpdateError('Cannot reach GitHub securely. Check internet and certificate settings, then retry.', 502)));
  });
}
async function latest(repo, get = json) {
  const base = `https://api.github.com/repos/${repo.owner}/${repo.name}`;
  const release = await get(`${base}/releases/latest`);
  const info = release ? null : await get(base);
  if (!release && (!info || info.private)) throw new UpdateError('Repository not found. This updater supports public GitHub repositories.');
  const ref = release?.tag_name || info.default_branch;
  const commit = await get(`${base}/commits/${encodeURIComponent(ref)}`);
  if (!/^[a-f0-9]{40}$/.test(commit?.sha || '')) throw new UpdateError('GitHub did not return a valid update revision.', 502);
  const manifest = validateManifest(await get(`https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${commit.sha}/market-update.json`));
  return { commit: commit.sha, manifest, name: String(release?.name || release?.tag_name || `Version ${manifest.version}`).slice(0, 200),
    notes: String(release?.body || commit.commit?.message || '').slice(0, 10000),
    publishedAt: release?.published_at || commit.commit?.committer?.date || null,
    url: release?.html_url || `${repo.url}/commit/${commit.sha}`, repository: repo.url };
}
module.exports = { repository, json, latest };
