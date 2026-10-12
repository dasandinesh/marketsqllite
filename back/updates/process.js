const { spawn, fork } = require('node:child_process');
const path = require('node:path');

function waitMessage(child, type, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); child.off('message', message); child.off('exit', exit); child.off('error', fail); };
    const fail = error => { cleanup(); reject(error); };
    const exit = () => fail(new Error('The application stopped before it was ready.'));
    const message = value => {
      if (value?.type === 'update-error') fail(new Error(value.message));
      else if (value?.type === type) { cleanup(); resolve(value); }
    };
    const timer = setTimeout(() => fail(new Error('Application startup or update timed out.')), timeout);
    child.on('message', message); child.once('exit', exit); child.once('error', fail);
  });
}
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGTERM'), 10000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    if (child.connected) child.send({ type: 'shutdown' }, error => { if (error) child.kill('SIGTERM'); });
    else child.kill('SIGTERM');
  });
}
function childApp(directory, env, stdio = ['ignore', 'inherit', 'inherit', 'ipc']) {
  return fork(path.join(directory, 'back/sqlite-server.js'), [], { cwd: path.join(directory, 'back'), windowsHide: true, env, stdio });
}
async function healthy(child, version) {
  const ready = await waitMessage(child, 'ready');
  if (!Number.isInteger(ready.port) || ready.port < 1 || ready.port > 65535) throw new Error('Invalid application port.');
  const response = await fetch(`http://127.0.0.1:${ready.port}/api/health`, { signal: AbortSignal.timeout(10000) });
  const health = await response.json();
  if (!response.ok || !health.db || health.engine !== 'sqlite' || health.version !== version) throw new Error('The updated application did not pass its database health check.');
  return ready;
}
function npm(directory, args) {
  return new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    const child = spawn(windows ? 'cmd.exe' : 'npm', windows ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : args, {
      cwd: directory, windowsHide: true, stdio: 'inherit',
      env: { ...process.env, CI: 'false', NODE_TLS_REJECT_UNAUTHORIZED: '1', npm_config_strict_ssl: 'true' },
    });
    const timer = setTimeout(() => {
      if (windows) spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGKILL');
      reject(new Error('Dependency installation or build timed out.'));
    }, 20 * 60 * 1000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Dependency installation or build failed.')); });
  });
}
module.exports = { waitMessage, stopChild, childApp, healthy, npm };
