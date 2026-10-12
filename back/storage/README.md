# SQLite desktop edition

The same React screens and billing controllers can run with a local SQLite database. No MongoDB Server installation, service or internet connection is required for local work. Mongoose remains a JavaScript dependency for the existing schemas, validation, defaults and BSON ID types; SQLite handles persistence in this mode.

## Start locally

Use **Node.js 24 or newer**. From the project:

```powershell
cd fornt
npm ci
npm run build
cd ../back
npm ci
npm run start:sqlite
```

Open `http://localhost:8000/dashboard`. The backend serves the built React app, including direct links such as `/sale-entry`, so no frontend development server is needed for normal local use. Stop another backend using port 8000 first, or select another `PORT`.

For development, run `npm run dev:sqlite` in `back` and `npm start` in `fornt`.

`start:sqlite` uses the desktop launcher, which selects SQLite and supports software updates through **Preferences** in the navbar. It reads the existing `back/config/config.env` for other settings but does not use `DB_LOCAL_URL`. Alternatively, set `DB_ENGINE=sqlite` in that file and run `npm start`; that direct launch does not support installing updates. Use `config/sqlite.env.example` as a reference; preserve any private settings when editing an existing configuration. See the [software update guide](../updates/README.md).

The default database is `back/data/market.sqlite`. Set `SQLITE_FILE` to change it; relative paths resolve from `back`, and absolute paths are supported. The directory and empty database are created automatically. SQLite mode binds to `127.0.0.1` by default. Configure `HOST` explicitly if trusted local-network access is needed.

The MongoDB/cloud profile remains available with `DB_ENGINE=mongodb` and `npm start`. Changing profiles does not automatically copy data between databases.

## Import current MongoDB data

1. In the MongoDB version, use **Dashboard → Download backup** and keep the file separately.
2. Stop that backend and start the SQLite version.
3. In its Dashboard, choose **Restore from backup**, select the JSON export, and confirm the replacement.

The import preserves existing IDs, nested bill lines, BSON dates, balances and counters. Only the known application collections are accepted. A failed SQLite restore rolls back the entire restore. It does not delete or modify the original MongoDB database. SQLite starts empty until you import data or enter new records.

## Backup and restore

- **Download backup** exports business records as the existing Extended JSON format. It is a consistent snapshot and can be used for SQLite import/restore or transfer back to the MongoDB profile. It excludes sync metadata.
- **Download SQLite file** uses the SQLite online backup API, so it is safe while the database is open in WAL mode. The file contains business records, change tracking and sync checkpoints.
- To recover from a native `.sqlite` backup, stop the backend and set `SQLITE_FILE` to a private copy of the backup before restarting. The backup preserves its installation identifier, so sync checkpoints still match if its file path changes. Keep only one active local writer for a restored installation.
- Do not copy only the active `.sqlite` file while the backend is running: recent writes can be in its `-wal` file. Use the backup buttons. JSON restore accepts `.json` exports, not native SQLite files.

The database and its journal files are ignored by Git. Keep customer backups private and separate from source-code backups.

## Optional Atlas sync

Open **Master → Atlas Sync**, enter an Atlas SRV connection string and database, test, enable automatic sync if desired, and save. The background worker can upload SQLite records and download MongoDB records, including updates and deletions. It uses the existing direct Atlas connection from the local backend; a cloud API or hosting deployment is not created automatically.

Credentials for this edition are stored separately in `back/.atlas-sync-sqlite/`, rather than using the MongoDB profile's saved connection. A custom `ATLAS_SYNC_DATA_DIR` overrides that location. Keep the encrypted connection file and its encryption key together, private and outside source control. A native database backup does not include these separate credential files.

Sync metadata is in the SQLite database's metadata namespace. Local writes and their coalesced change entry commit together. A queue entry is cleared only when the current local record matches the acknowledged shared version. Checkpoints and deletion history survive restart and native backup recovery. Competing edits require review on the sync page.

This supports one local installation plus its cloud copy. Independent offline installations, or simultaneous local/cloud bill entry, still need bill-number coordination and cross-record financial conflict rules. Pause sync before a bulk restore and wait for a running check to finish. Review the resulting merge before resuming.

## Implementation and limits

Business documents are stored in an indexed SQLite table using Extended JSON. This keeps the current nested document structure and BSON IDs compatible with Atlas. Shared model adapters support the queries used by this app; they are not a general replacement for every Mongoose/MongoDB feature. Local filtering/report sorting and sync snapshots currently read documents into memory, so this edition targets modest single-installation billing databases.

SQLite uses WAL, full synchronous durability and a busy timeout. Mutating API controllers run in serialized transactions: counters, bills/receipts, balances and dirty records commit together. Error responses roll back their changes. Other requests do not see partial work.

Schema version 1 contains `documents`, `changes` and `settings`. A database with a newer schema version is rejected instead of being downgraded. This is a local browser application served by Node.js; a native desktop installer/Electron package is a separate packaging step.

## Tests

```powershell
cd back
npm run test:sqlite
```

The default tests use temporary SQLite files and a simulated cloud store. To also check SQLite against a real MongoDB destination on a separate disposable test database:

```powershell
$env:RUN_SQLITE_MONGO_INTEGRATION = '1'
node --test storage/sync.test.js
Remove-Item Env:RUN_SQLITE_MONGO_INTEGRATION
```

That test defaults to `mongodb://127.0.0.1:27017`; `ATLAS_SYNC_TEST_URI` can select another test MongoDB. It creates and removes only a randomly named `market_sqlite_sync_test_` database. It does not use your app database or verify real Atlas DNS, TLS, credentials or network allowlists.
