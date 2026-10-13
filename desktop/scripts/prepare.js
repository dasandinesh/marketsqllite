const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const desktop = path.resolve(__dirname, '..');
const root = path.dirname(desktop);
const manifest = require(path.join(root, 'market-update.json'));
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build this installer on 64-bit Windows.');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24+ is required to build.');
for (const file of ['desktop/package.json', 'back/package.json']) {
  if (require(path.join(root, file)).version !== manifest.version) throw new Error(`Version in ${file} must match market-update.json.`);
}
function npm(cwd, args) {
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], { cwd, windowsHide: true, stdio: 'inherit',
    env: { ...process.env, CI: 'false', NODE_TLS_REJECT_UNAUTHORIZED: '1', npm_config_strict_ssl: 'true' } });
  if (result.error || result.status !== 0) throw new Error('Dependency installation or frontend build failed.');
}
const staging = path.join(desktop, 'staging');
const code = path.join(staging, 'app-code');
// Staging belongs only to this build; never copy configuration, databases or sync credentials.
if (fs.existsSync(staging)) {
  const resolved = fs.realpathSync(staging);
  if (path.dirname(resolved) !== fs.realpathSync(desktop) || path.basename(resolved) !== 'staging') throw new Error('Invalid build staging directory.');
  fs.rmSync(resolved, { recursive: true, force: true });
}
fs.mkdirSync(path.join(code, 'back'), { recursive: true });
function copyBackend(directory, relative = '') {
  const sourceFolders = new Set(['atlas-sync', 'config', 'controllers', 'model', 'routers', 'storage', 'updates']);
  const rootFiles = new Set(['app.js', 'server.js', 'sqlite-server.js', 'desktop-launcher.js', 'package.json', 'package-lock.json']);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Links are not allowed in backend build inputs.');
    if (entry.isDirectory()) {
      if (!relative && !sourceFolders.has(entry.name)) continue;
      if (['node_modules', 'data'].includes(entry.name) || entry.name.startsWith('.')) continue;
      copyBackend(path.join(directory, entry.name), path.join(relative, entry.name));
    } else if ((!relative ? rootFiles.has(entry.name) : entry.name.endsWith('.js')) && !entry.name.endsWith('.test.js')) {
      const target = path.join(code, 'back', relative, entry.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(directory, entry.name), target);
    }
  }
}
copyBackend(path.join(root, 'back'));
fs.copyFileSync(path.join(root, 'market-update.json'), path.join(code, 'market-update.json'));
npm(path.join(code, 'back'), ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
npm(path.join(root, 'fornt'), ['run', 'build']);
fs.cpSync(path.join(root, 'fornt/build'), path.join(code, 'fornt/build'), { recursive: true });
fs.mkdirSync(path.join(staging, 'runtime'), { recursive: true });
fs.copyFileSync(process.execPath, path.join(staging, 'runtime/node.exe'));
fs.writeFileSync(path.join(staging, 'runtime/version.json'), JSON.stringify({ node: process.versions.node, architecture: process.arch }));
require('./runtime-license').runtimeLicense(path.join(staging, 'runtime'), process.versions.node)
  .then(() => console.log(`Prepared Market ${manifest.version} with bundled Node ${process.versions.node} and its license notices.`))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
