# Market SQLite desktop billing

The SQLite desktop edition is maintained at [dasandinesh/marketsqllite](https://github.com/dasandinesh/marketsqllite). The original MongoDB/cloud project is at [dasandinesh/market](https://github.com/dasandinesh/market).

React frontend in `fornt/` and an Express backend in `back/`, with MongoDB/cloud and SQLite/local storage profiles. Features include customer/product management, orders, sales, receipts, ledgers, bill previews/PDF sharing, file backup/restore, and optional synchronization to MongoDB Atlas.

For the SQLite desktop edition, use Node.js 24+:

```powershell
git clone https://github.com/dasandinesh/marketsqllite.git
cd marketsqllite/fornt
npm ci
npm run build
cd ../back
npm ci
npm run start:sqlite
```

It serves the frontend and API locally at `http://localhost:8000/dashboard` without a local MongoDB service. The default database is `back/data/market.sqlite`; it starts empty on a new installation. See the [SQLite setup, migration and backup guide](back/storage/README.md).

Open **Preferences** in the navbar to save a public GitHub repository link, check for a compatible newer version, prepare it, and install/restart locally. The managed SQLite launcher keeps the database and private settings outside downloaded versions, creates a database recovery backup, and attempts rollback if startup fails. See the [customer update and publishing guide](back/updates/README.md).

## MongoDB profile (optional)

The instructions below run the MongoDB profile.

Install Node.js/npm and a compatible MongoDB Community Server, then start MongoDB.

Copy `back/config/config.env.example` to `back/config/config.env`. Update `DB_LOCAL_URL` with the database you intend to use. The example uses backend port `8000`, which matches the frontend development proxy.

In one terminal:

```powershell
cd back
npm ci
npm start
```

In a second terminal:

```powershell
cd fornt
npm ci
npm start
```

Open `http://localhost:3000/dashboard`.

## Atlas sync

Open **Master → Atlas Sync** to configure a customer-owned Atlas database. Local billing continues without internet while the local backend and selected database are running. Automatic sync checks run while the backend is running.

See [Atlas Sync setup and limitations](back/atlas-sync/README.md) for access controls, conflict handling, metadata storage and verification. A separate hosted billing deployment and authentication setup are required for cloud access; setting up Atlas sync alone does not host this app.

## Backup

GitHub stores the application source, not MongoDB business data. Use **Dashboard → Download backup** for a business-data backup, and store backups separately from the repository. Local environment files and encrypted Atlas connection settings are excluded from Git.

## Checks

Backend unit tests:

```powershell
cd back
node --test storage/*.test.js atlas-sync/*.test.js controllers/*.test.js updates/*.test.js
```

The Atlas integration test is opt-in; see its setup guide before running it.

Frontend tests and production build:

```powershell
cd fornt
npm test -- --watchAll=false --runInBand
npm run build
```
