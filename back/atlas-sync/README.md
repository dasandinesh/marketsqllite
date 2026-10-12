# Atlas Sync

Independent two-way sync for this app's **one local installation** and one customer-owned Atlas database. The local store can be MongoDB or the SQLite desktop edition. File backup/restore operates separately. No Atlas connection is configured by default. For SQLite launch and storage details, see the [SQLite guide](../storage/README.md).

## Setup

1. Start the selected local database and backend: MongoDB with `npm start`, or SQLite with `npm run start:sqlite` in `back`.
2. In the app, open **Master → Atlas Sync** (`/atlas-sync`).
3. Create a dedicated Atlas database user with `readWrite` access to the chosen database. Sync needs permission to read/write records, list collections, and create the app's indexes. Allow the backend computer's public IP in Atlas Network Access. Update that allowance if the public IP changes.
4. Paste the Atlas SRV connection string (`mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority`). Replace placeholders; percent-encode special characters in username/password. Enter the destination database name separately.
5. Test the connection, enable automatic sync if desired, and save. **Sync Now** starts a check immediately. Automatic checks run every 30 seconds while the backend is running, even when the page is closed.

Saving works without internet. A connection test verifies connectivity and collection access without changing data; it does not verify every write/index permission. Failed sync checks leave local business data and checkpoints in place for the next attempt.

The initial sync merges records by `_id`: local-only records upload; Atlas-only records download; identical records converge; different records with the same `_id` require review. It does not replace either entire database. Subsequent sync checks compare both versions to the last shared version, including deleted records. Offline changes are coalesced to their current state, rather than retaining every intermediate edit.

## Storage and access

- The module is isolated in `back/atlas-sync`, with API routes at `/api/atlas-sync` and its own Atlas MongoClient. No business schema modifications or MongoDB replica-set configuration are required for local storage.
- Credentials are AES-256-GCM encrypted in `back/.atlas-sync/connection.json`. The encryption key is in the same directory, which is ignored by Git. Protect this directory with the backend account's filesystem permissions and preserve the key when moving the installation. Encryption does not protect against someone who can read both files.
- Optional `ATLAS_SYNC_DATA_DIR` selects a different absolute settings directory. Protect custom directories and exclude them from source control too.
- Only the non-secret hostname/database/status are returned to the page. Driver errors and connection credentials are not exposed by the API. Only password-authenticated Atlas SRV URLs with verified TLS and supported connection options are accepted.
- Sync bookkeeping and conflict snapshots live in the separate local database `market_atlas_sync_metadata`. The local MongoDB user needs read/write access to this database in addition to the app database. Keep it if you want to preserve deletion history and sync progress across reinstallations. The normal file backup does not include it.
- In SQLite mode, bookkeeping and conflict snapshots are stored in the SQLite file's metadata namespace. Credentials are in `.atlas-sync-sqlite/` by default. Business JSON exports exclude metadata; native SQLite backups include it.
- By default, Atlas administration accepts loopback requests and rejects non-local browser origins for settings access. To administer from other computers, set a strong `ATLAS_SYNC_ADMIN_TOKEN` in the backend environment/config file and restart the backend, then enter that token on the Atlas page. Once configured, the token is required even locally. Use HTTPS when exposing the app beyond a trusted local computer/network. This feature does not add user accounts or tenant isolation to the rest of the app.

Disconnecting removes the saved connection and stops automatic checks; it keeps both databases and sync metadata. Reconnecting to the same host/database resumes its checkpoints. Choosing another destination requires confirmation and uses separate checkpoints for a new merge.

## Conflict and recovery behavior

- Concurrent edits or delete-versus-edit changes hold the affected record for review. Review both snapshots and choose **Keep Local** or **Keep Atlas**. Choosing a deleted version deletes the other version as well. A stale choice is rejected if the record or displayed snapshots changed.
- Destination writes/deletes compare the full scanned BSON document atomically; an application edit after the scan is left for the next check. Inserts keep the original `_id`, and same-ID insert races are retried. Checkpoints advance only after a successful write; equal versions recover interrupted writes without duplication.
- Unique-index collisions are held for review instead of replacing unrelated records. Correct the colliding field/record, then sync again. Existing local indexes are also created in Atlas.
- Counters keep the greater `seq` value and are not propagated as deletions, so local bill/voucher sequences do not move backwards.
- The connection status means the last check's result; **Last completed sync check** may still have unresolved conflicts. Pending counts are recalculated during checks and exclude conflicts, which have their own count. Pausing automatic sync leaves **Sync Now** available.

## Practical limits

This is a snapshot-based sync for a modest database: it scans the listed application collections each round and holds a collection's documents in memory. It syncs current final document state, not every event. Conflict snapshots use Extended JSON in separate metadata documents and must fit MongoDB's document size limit. Unknown collections are not synced. ObjectIds and dates round-trip as BSON.

Use a dedicated cloud copy for this installation. This is not a multi-device billing coordination service: multiple independent offline installations can generate duplicate bill numbers. Related customer/bill/payment changes are copied per document, not as a transaction across both databases; do not edit related financial records from multiple writers during a sync. Cloud-side edits must preserve the application's schema, IDs and relationships. Sync does not replay application controllers or recompute financial totals.

Sync is a current cloud copy, not historical backup: it also copies accidental deletions and bad edits. Continue downloading file backups or configure Atlas historical backups separately. Before a bulk restore, pause automatic sync and wait for a running check to finish; inspect the resulting merge before resuming. If metadata is lost, initial merge semantics apply again, so old deletions cannot be inferred.

## Verification

From `back`:

```powershell
node --test atlas-sync/reconcile.test.js atlas-sync/config.test.js atlas-sync/routes.test.js atlas-sync/service.test.js
$env:RUN_ATLAS_SYNC_INTEGRATION = '1'
node --test atlas-sync/service.integration.test.js
Remove-Item Env:RUN_ATLAS_SYNC_INTEGRATION
```

The integration test defaults to `mongodb://127.0.0.1:27017`, uses three disposable databases with random `market_atlas_test_` names, and removes only those databases afterward. `ATLAS_SYNC_TEST_URI` can point at a separate test MongoDB. It checks the database sync logic using a local database as the cloud destination; it does not verify real Atlas DNS, TLS, IP access lists or credentials.

From `fornt`, run `npm test -- --watchAll=false --runInBand --testPathPattern=AtlasSync` and `npm run build`.
