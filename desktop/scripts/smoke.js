const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'market-desktop-smoke-'));
const exe = process.env.MARKET_SMOKE_EXE || path.resolve(__dirname, '../../dist/desktop/win-unpacked/Market Billing.exe');
async function launch() {
  const env = { ...process.env, PATH: path.join(process.env.SystemRoot || 'C:/Windows', 'System32'),
    MARKET_DESKTOP_USER_DATA: directory, NODE_TLS_REJECT_UNAUTHORIZED: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, ['--smoke-test'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Packaged app smoke test timed out.')); }, 90000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Packaged app exited ${code}: ${output}\n${fs.existsSync(path.join(directory, 'desktop.log')) ? fs.readFileSync(path.join(directory, 'desktop.log'), 'utf8') : ''}`)); });
  });
  return JSON.parse(fs.readFileSync(path.join(directory, 'smoke-result.json'), 'utf8'));
}
(async () => {
  try {
    const first = await launch(); assert.equal(first.restoredCustomer, false);
    const second = await launch(); assert.equal(second.restoredCustomer, true); assert.equal(first.customerId, second.customerId);
    console.log(JSON.stringify({ ...second, database: '<isolated temporary database>', launches: 2, externalNodeOrNpmRequired: false }, null, 2));
  } finally {
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('market-desktop-smoke-')) throw new Error('Unsafe smoke cleanup path.');
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
