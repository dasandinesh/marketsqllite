const { spawn } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), ['.'], { cwd: path.resolve(__dirname, '..'), env, windowsHide: true, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
