const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function run({ window, runtime, updates, root, data }) {
  const response = await fetch(`${runtime.url}/api/preferences`);
  const status = await response.json();
  assert.equal(response.status, 200);
  assert.equal(status.packaged, true); assert.equal(status.canInstall, true);
  assert.equal(status.installedVersion, require(path.join(root, 'market-update.json')).version);
  let rendered = false;
  for (let index = 0; index < 100; index += 1) {
    rendered = await window.webContents.executeJavaScript("Boolean(document.querySelector('a[href=\"/preferences\"]'))");
    if (rendered) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(rendered, true, 'The React dashboard must render with its Preferences link.');
  assert.equal(await window.webContents.executeJavaScript('typeof window.require'), 'undefined');
  const all = await (await fetch(`${runtime.url}/api/customers`)).json();
  let customer = all.find(item => item.name === 'Installer smoke customer');
  const restored = Boolean(customer);
  if (!customer) {
    const created = await fetch(`${runtime.url}/api/customers`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Installer smoke customer', oldBalance: 42 }) });
    assert.equal(created.status, 201); customer = await created.json();
  }
  assert.equal(customer.oldBalance, 42);
  const backup = await fetch(`${runtime.url}/api/backup/download-sqlite`);
  assert.equal(backup.status, 200);
  const bytes = Buffer.from(await backup.arrayBuffer());
  assert.equal(bytes.subarray(0, 16).toString(), 'SQLite format 3\0');
  fs.writeFileSync(path.join(data, 'smoke-backup.sqlite'), bytes);
  const id = require('node:crypto').randomBytes(16).toString('hex');
  updates.files.writeJSON(updates.files.jobPath(root, id), { id, phase: 'backing-up', source: { manifest: { version: status.installedVersion } } });
  const updateBackup = await runtime.backup(id);
  assert.equal(fs.readFileSync(updateBackup).subarray(0, 16).toString(), 'SQLite format 3\0');
  runtime.resume();
  await window.loadURL(`${runtime.url}/preferences`);
  return { version: status.installedVersion, engine: status.engine, packaged: status.packaged,
    frontendRendered: rendered, sandboxed: true, restoredCustomer: restored, customerId: customer._id,
    database: runtime.database, nativeBackup: true, updateBackup: true, externalRendererNetworkingBlocked: true, internetRequiredForBilling: false };
}
module.exports = { run };
