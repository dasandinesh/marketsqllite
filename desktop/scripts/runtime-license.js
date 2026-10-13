const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
async function runtimeLicense(directory, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid bundled Node version.');
  const license = await new Promise((resolve, reject) => {
    const request = https.get(`https://raw.githubusercontent.com/nodejs/node/v${version}/LICENSE`, { rejectUnauthorized: true }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('Could not obtain the bundled Node runtime license.')); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) request.destroy(new Error('Runtime license exceeds the limit.')); else chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks))); response.on('error', reject);
    });
    request.setTimeout(30000, () => request.destroy(new Error('Runtime license download timed out.'))); request.on('error', reject);
  });
  fs.writeFileSync(path.join(directory, 'LICENSE.node.txt'), license);
}
module.exports = { runtimeLicense };
