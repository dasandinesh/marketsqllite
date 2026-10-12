const mongoose = require('mongoose');

function engine() {
  const name = (process.env.DB_ENGINE || 'mongodb').toLowerCase();
  if (!['sqlite', 'mongodb'].includes(name)) throw new Error('DB_ENGINE must be sqlite or mongodb.');
  return name;
}
function localDb() {
  if (engine() === 'sqlite') {
    const store = require('./sqlite').existingStore();
    return store?.open ? store.namespace() : null;
  }
  return mongoose.connection.readyState === 1 ? mongoose.connection.db : null;
}
function metadataDb() {
  return engine() === 'sqlite' ? require('./sqlite').getStore().namespace('metadata')
    : mongoose.connection.getClient().db('market_atlas_sync_metadata');
}
function health() {
  return { engine: engine(), db: Boolean(localDb()), dbState: engine() === 'sqlite' ? (localDb() ? 1 : 0) : mongoose.connection.readyState };
}
module.exports = { engine, localDb, metadataDb, health };
