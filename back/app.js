const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
// Configuration must load before selecting the storage adapters for the models.
dotenv.config({ path: process.env.MARKET_CONFIG_FILE || path.join(__dirname, 'config/config.env') });
const storage = require('./storage');
const connectDatabase = require('./config/database');

const cookieParser = require('cookie-parser');
const app = express();
const custumerrouter = require('./routers/customerrouters'); 
const productrouter = require('./routers/productroutes');
const unitrouter = require('./routers/unitroutes');
const orderrouter = require('./routers/orderroutes');
const salerouter = require('./routers/saleroutes');
const invoicesettingrouter = require('./routers/invoicesettingroutes');
const receiptrouter = require('./routers/receiptroutes');
const ledgerrouter = require('./routers/ledgerroutes');
const backuprouter = require('./routers/backuproutes');
const driverrouter = require('./routers/driverroutes');
const vehiclerouter = require('./routers/vehicleroutes');
const atlasSyncRouter = require('./atlas-sync/routes');
const preferencesRouter = require('./updates/routes');
const applicationVersion = require('node:fs').existsSync(path.join(__dirname, '../market-update.json'))
  ? require('../market-update.json').version : require('./package.json').version;

app.locals.databaseReady = connectDatabase();

app.use(
  cors({
    origin: ["http://127.0.0.1:3000", "http://localhost:3000","http://192.168.1.103:3000"],
      methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true, // ✅ Allows cookies
  })
);
app.use(cookieParser());
app.locals.maintenance = process.env.MARKET_UPDATE_STARTING === '1';
app.locals.activeWrites = 0;
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    if (app.locals.maintenance) return res.status(503).json({ error: 'A software update is restarting the app. Wait for it to finish before saving.' });
    app.locals.activeWrites += 1;
    let finished = false;
    const finish = () => { if (!finished) { finished = true; app.locals.activeWrites -= 1; } };
    res.once('finish', finish); res.once('close', finish);
  }
  next();
});
app.use(express.json());
app.use('/api/customers', custumerrouter);
app.use('/api/products', productrouter);
app.use('/api/units', unitrouter);
app.use('/api/orders', orderrouter);
app.use('/api/sales', salerouter);
app.use('/api/invoice-settings', invoicesettingrouter);
app.use('/api/receipts', receiptrouter);
app.use('/api/ledger', ledgerrouter);
app.use('/api/backup', backuprouter);
app.use('/api/drivers', driverrouter);
app.use('/api/vehicles', vehiclerouter);
app.use('/api/atlas-sync', atlasSyncRouter());
app.use('/api/preferences', preferencesRouter());

// Health check for the dashboard's three status lights: this endpoint answering at
// all means the backend is up; its `db` field says whether Mongo is connected.
// readyState: 0 disconnected, 1 connected, 2 connecting, 3 disconnecting.
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    ...storage.health(),
    version: applicationVersion,
    time: new Date().toISOString(),
  });
});

// Desktop mode serves a built frontend from the same local process and supports
// direct navigation to React routes. API paths never fall through to HTML.
if (storage.engine() === 'sqlite' && require('node:fs').existsSync(path.join(__dirname, '../fornt/build/index.html'))) {
  app.use(express.static(path.join(__dirname, '../fornt/build'), { index: false }));
  app.get(/^(?!\/api(?:\/|$)).*/, (req, res) => {
    if (req.path === '/') return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, '../fornt/build/index.html'));
  });
}

module.exports = app;
