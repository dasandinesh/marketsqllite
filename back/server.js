const app = require('./app'); // Fixed path (use './app' if it's in the same directory)
const path = require('path');
const { service: atlasSync } = require('./atlas-sync/service');

// app.js connects the local database. Atlas uses its own independent connection.

// Start the server
const storage = require('./storage');
const PORT = process.env.PORT || (storage.engine() === 'sqlite' ? 8000 : 5000);
const HOST = process.env.HOST || (storage.engine() === 'sqlite' ? '127.0.0.1' : '0.0.0.0');

async function start() {
    if (storage.engine() === 'sqlite') await app.locals.databaseReady;
    const server = app.listen(PORT, HOST, () => {
    if (!app.locals.maintenance) atlasSync.start();
    const boundPort = server.address().port;
    console.log(`Server listening on ${HOST}:${boundPort} in ${process.env.NODE_ENV} mode`);
    console.log(`Local access: http://localhost:${boundPort}`);
    console.log(`Network access: http://YOUR_LOCAL_IP:${boundPort}`);
    console.log('To find your local IP, run: ipconfig (Windows) or ifconfig (Mac/Linux)');
    if (process.send) process.send({ type: 'ready', port: boundPort });
    });
    let stopping = false;
    const stop = () => {
        if (stopping) return;
        stopping = true;
        atlasSync.stop();
        server.close(async () => {
            try {
                const store = storage.engine() === 'sqlite' ? require('./storage/sqlite').existingStore() : null;
                if (store?.open) await store.close();
                process.exit(0);
            } catch { process.exit(1); }
        });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    if (process.send) {
        process.once('disconnect', stop);
        process.on('message', async message => {
            if (message?.type === 'shutdown') { stop(); return; }
            if (message?.type === 'resume-service') { app.locals.maintenance = false; atlasSync.start(); return; }
            if (message?.type !== 'begin-update' || storage.engine() !== 'sqlite') return;
            app.locals.maintenance = true;
            atlasSync.stop();
            try {
                const files = require('./updates/files');
                const filename = files.jobPath(files.rootDirectory(), message.id);
                if (files.readJSON(filename)?.phase !== 'backing-up') throw new Error('Update is not ready for a backup.');
                const deadline = Date.now() + 30000;
                while (app.locals.activeWrites || atlasSync.running) {
                    if (Date.now() > deadline) throw new Error('Wait for current saves and sync to finish, then retry.');
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                await require('./storage/sqlite').getStore().backup(path.join(path.dirname(filename), 'database.sqlite'));
                process.send({ type: 'update-backed-up', id: message.id });
            } catch (error) {
                app.locals.maintenance = false; atlasSync.start();
                process.send({ type: 'update-error', message: error.message });
            }
        });
    }
}
start().catch(error => { console.error(`Unable to start the database: ${error.message}`); process.exitCode = 1; });
