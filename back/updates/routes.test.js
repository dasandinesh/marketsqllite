const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const createRouter = require('./routes');

test('preferences administration rejects foreign origins, non-JSON actions and incorrect access keys', async () => {
  const previous = process.env.ATLAS_SYNC_ADMIN_TOKEN;
  process.env.ATLAS_SYNC_ADMIN_TOKEN = 'test-settings-access-key';
  const saved = [];
  const app = express();
  app.use(express.json());
  app.use('/api/preferences', createRouter({ status: () => ({ installedVersion: '1.2.0' }),
    save: repository => { saved.push(repository); return { repository }; } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/preferences`;
  const auth = { Authorization: 'Bearer test-settings-access-key' };
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(base, { headers: { ...auth, Origin: 'https://untrusted.example' } })).status, 403);
    assert.equal((await fetch(base, { headers: { ...auth, Origin: 'bad-origin' } })).status, 403);
    assert.equal((await fetch(`${base}/repository`, { method: 'PUT', headers: auth, body: 'repository=value' })).status, 415);
    const read = await fetch(base, { headers: { ...auth, Origin: 'http://localhost:3000' } });
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    const repository = 'https://github.com/dasandinesh/marketsqllite';
    const write = await fetch(`${base}/repository`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ repository }) });
    assert.equal(write.status, 200);
    assert.deepEqual(saved, [repository]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.ATLAS_SYNC_ADMIN_TOKEN;
    else process.env.ATLAS_SYNC_ADMIN_TOKEN = previous;
  }
});
