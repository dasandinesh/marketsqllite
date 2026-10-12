const mongoose = require('mongoose');

function connectDatabase() {
  const { engine } = require('../storage');
  if (engine() === 'sqlite') {
    const store = require('../storage/sqlite').getStore();
    return store.initializeIndexes().then(() => console.log(`[db] SQLite ready at ${store.filename}`));
  }
  const uri = process.env.DB_LOCAL_URL;
  if (!uri) {
    console.error('[db] DB_LOCAL_URL not configured');
    return;
  }
  return mongoose
    .connect(uri, {
      maxPoolSize: 20,
    })
    .then(() => {
      console.log('[db] MongoDB connected');
    })
    .catch((error) => {
      console.error('[db] MongoDB connection failed. Check DB_LOCAL_URL and database availability.');
    });
}

module.exports = connectDatabase;
