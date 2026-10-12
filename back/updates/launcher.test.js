const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SQLiteStore } = require('../storage/sqlite');
const { DesktopLauncher } = require('./launcher');
const files = require('./files');

const fixtureServer = `
const fs=require('node:fs'), path=require('node:path'), http=require('node:http');
const {DatabaseSync,backup}=require('node:sqlite');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../market-update.json')));
const db=new DatabaseSync(process.env.SQLITE_FILE); db.exec('PRAGMA journal_mode=WAL');
if(fs.existsSync(path.join(__dirname,'fail-startup'))) {
 db.prepare('UPDATE documents SET payload=? WHERE collection=?').run(JSON.stringify({_id:'customer',name:'Bad startup',oldBalance:999}),'customers');
 db.close(); process.exit(17);
}
const server=http.createServer((req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.url==='/api/health')res.end(JSON.stringify({engine:'sqlite',db:true,version:manifest.version}));
 else if(req.url==='/api/preferences')res.end(JSON.stringify({installedVersion:process.env.MARKET_RUNNING_VERSION || manifest.version}));
 else res.end(JSON.stringify(db.prepare('SELECT payload FROM documents WHERE collection=?').all('customers')));
});
server.listen(Number(process.env.PORT),'127.0.0.1',()=>process.send({type:'ready',port:server.address().port}));
process.on('message',async message=>{
 if(message.type==='begin-update') {
  const filename=path.join(process.env.MARKET_INSTALL_ROOT,'.market-updates/jobs',message.id,'database.sqlite');
  await backup(db,filename);process.send({type:'update-backed-up',id:message.id});
 }
 if(message.type==='shutdown')server.close(()=>{db.close();process.exit(0)});
});
process.on('disconnect',()=>server.close(()=>{db.close();process.exit(0)}));
`;

function fixture(directory, version, failing = false) {
  fs.mkdirSync(path.join(directory, 'back'), { recursive: true });
  files.writeJSON(path.join(directory, 'market-update.json'), { application: 'market-billing', protocol: 1, version, databaseSchema: 1, minimumNodeMajor: 24 });
  fs.writeFileSync(path.join(directory, 'back/sqlite-server.js'), fixtureServer);
  if (failing) fs.writeFileSync(path.join(directory, 'back/fail-startup'), '');
}

test('desktop launcher installs a prepared version and restores both code and data after failed startup', { timeout: 60000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'market-update-launch-test-'));
  fixture(root, '1.2.0');
  const database = path.join(root, 'customer.sqlite');
  let store = new SQLiteStore(database);
  await store.namespace().collection('customers').insertOne({ _id: 'customer', name: 'Preserved customer', oldBalance: 42 });
  await store.close();
  fs.writeFileSync(path.join(root, 'private.env'), 'PRIVATE=retained');
  const launcher = new DesktopLauncher(root, { ...process.env, PORT: '0', SQLITE_FILE: database, MARKET_CONFIG_FILE: path.join(root, 'private.env') });
  try {
    await launcher.launch();
    const id = '1'.repeat(32); const release = `releases/${id}`;
    fixture(files.releasePath(root, release), '2.0.0');
    files.writeJSON(files.jobPath(root, id), { id, phase: 'backing-up', release, source: { commit: 'a'.repeat(40), manifest: files.manifestAt(files.releasePath(root, release)) } });
    await launcher.install(id);
    assert.equal(files.readJSON(files.jobPath(root, id)).phase, 'installed');
    assert.equal(launcher.state().version, '2.0.0');
    assert.equal((await (await fetch(`http://127.0.0.1:${launcher.baseEnv.PORT}/api/health`)).json()).version, '2.0.0');
    const failed = '2'.repeat(32); const failedRelease = `releases/${failed}`;
    fixture(files.releasePath(root, failedRelease), '3.0.0', true);
    files.writeJSON(files.jobPath(root, failed), { id: failed, phase: 'backing-up', release: failedRelease,
      source: { commit: 'b'.repeat(40), manifest: files.manifestAt(files.releasePath(root, failedRelease)) } });
    await launcher.install(failed);
    assert.equal(files.readJSON(files.jobPath(root, failed)).phase, 'rolled-back');
    assert.equal(launcher.state().version, '2.0.0');
    assert.equal((await (await fetch(`http://127.0.0.1:${launcher.baseEnv.PORT}/api/health`)).json()).version, '2.0.0');
    await launcher.stop();
    store = new SQLiteStore(database);
    const customer = await store.namespace().collection('customers').findOne({ _id: 'customer' });
    assert.equal(customer.name, 'Preserved customer');
    assert.equal(customer.oldBalance, 42);
    assert.equal(fs.readFileSync(path.join(root, 'private.env'), 'utf8'), 'PRIVATE=retained');
    assert.ok(fs.existsSync(path.join(path.dirname(files.jobPath(root, failed)), 'database.sqlite')));
  } finally {
    await launcher.stop();
    if (store.open) await store.close();
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('market-update-launch-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('interrupted activation restores the recorded backup before the next launch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'market-update-recovery-test-'));
  fixture(root, '1.2.0');
  const database = path.join(root, 'customer.sqlite');
  const store = new SQLiteStore(database);
  const id = '3'.repeat(32); const previous = { active: null, version: '1.2.0', commit: null };
  try {
    await store.namespace().collection('customers').insertOne({ _id: 'customer', oldBalance: 42 });
    files.writeJSON(files.jobPath(root, id), { id, phase: 'restarting', previous, backupCreated: true, source: { manifest: { version: '2.0.0' } } });
    await store.backup(path.join(path.dirname(files.jobPath(root, id)), 'database.sqlite'));
    await store.namespace().collection('customers').updateOne({ _id: 'customer' }, { $set: { oldBalance: 999 } });
    await store.close();
    files.writeJSON(files.statePath(root), { active: `releases/${id}`, version: '2.0.0', pendingJob: id });
    const launcher = new DesktopLauncher(root, { ...process.env, SQLITE_FILE: database });
    await launcher.recoverInterrupted();
    assert.deepEqual(launcher.state(), previous);
    const recovered = new SQLiteStore(database);
    try { assert.equal((await recovered.namespace().collection('customers').findOne({ _id: 'customer' })).oldBalance, 42); }
    finally { await recovered.close(); }
  } finally {
    if (store.open) await store.close();
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('market-update-recovery-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an install request interrupted before activation does not leave preferences stuck', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'market-update-recovery-test-'));
  fixture(root, '1.2.0');
  try {
    const id = '4'.repeat(32);
    const preferences = path.join(root, 'preferences');
    files.writeJSON(path.join(preferences, 'software.json'), { jobId: id });
    files.writeJSON(files.jobPath(root, id), { id, phase: 'backing-up', source: { manifest: { version: '2.0.0' } } });
    const launcher = new DesktopLauncher(root, { ...process.env, SQLITE_FILE: path.join(root, 'unused.sqlite'), PREFERENCES_DIR: preferences });
    await launcher.recoverInterrupted();
    assert.equal(files.readJSON(files.jobPath(root, id)).phase, 'failed');
    assert.equal(launcher.state().active, null);
    assert.equal(fs.existsSync(launcher.baseEnv.SQLITE_FILE), false);
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('market-update-recovery-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preparation checks the candidate version independently of the currently running version', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'market-update-smoke-test-'));
  fixture(root, '2.0.0');
  const temporary = path.join(root, 'smoke');
  fs.mkdirSync(temporary);
  const previous = process.env.MARKET_RUNNING_VERSION;
  process.env.MARKET_RUNNING_VERSION = '1.2.0';
  try {
    await require('./installer').smokeUpdate(root, { source: { manifest: files.manifestAt(root), commit: 'a'.repeat(40) } }, temporary);
    assert.ok(fs.existsSync(path.join(temporary, 'smoke.sqlite')));
  } finally {
    if (previous === undefined) delete process.env.MARKET_RUNNING_VERSION;
    else process.env.MARKET_RUNNING_VERSION = previous;
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('market-update-smoke-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
