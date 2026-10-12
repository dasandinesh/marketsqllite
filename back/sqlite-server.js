// Select SQLite before loading app configuration or business models.
process.env.DB_ENGINE = 'sqlite';
process.env.HOST = process.env.HOST || '127.0.0.1';
require('./server');
