# Desktop software updates

This updater is for the SQLite edition served on localhost. It updates application code; Atlas sync transfers business records separately. The MongoDB/cloud server and the development watch command cannot install updates from this page.

## Customer steps

1. Complete the initial [SQLite setup](../storage/README.md), using Node.js 24+ and npm. Start with `npm run start:sqlite` in `back` each time, including after an update.
2. Open **Preferences** in the navbar at `http://localhost:8000/preferences`.
3. Paste the public GitHub repository URL supplied by your provider, such as `https://github.com/dasandinesh/marketsqllite`, and choose **Save Repository**. The `.git` suffix is also accepted. GitHub passwords and Vercel credentials are not needed. Private repositories are not supported. If an existing installation has saved the older `dasandinesh/market` URL, replace it here and save.
4. Choose **Check for Updates**, then **Prepare Update** when a newer compatible version is available. Internet access, npm, and at least 1 GB free disk space are needed. Large dependency installations can need more space. Continue billing while the separate copy is downloaded and built.
5. When it is ready, save unfinished bills and choose **Install and Restart**. Confirm the displayed version and trusted repository. Billing writes and Atlas sync pause, the database is backed up, and the local server restarts. Keep the launcher running. Preferences reconnects and reloads after installation or rollback. Reload other open app tabs afterward.

If `ATLAS_SYNC_ADMIN_TOKEN` is configured, use the **Settings access key** section. Update administration accepts only local connections and local browser origins. Customers should install only software from their trusted provider: preparing a repository runs its dependency installation/build scripts on their computer.

## Publish a compatible version

The SQLite edition is maintained in `https://github.com/dasandinesh/marketsqllite`. This repository contains the desktop implementation and root `market-update.json`. An older project without that manifest is rejected.

For each new version:

1. Keep the complete application source, both package-lock files, launcher/updater, SQLite adapter and Preferences page in the repository. Never commit customer databases, private environment files or connection keys.
2. Increase the three-part version in the root `market-update.json` and `back/package.json`; update the root version in `back/package-lock.json` too. For example, change `1.2.0` to `1.2.1`.
3. Keep `application: "market-billing"`, `protocol: 1`, `databaseSchema: 1`, and `minimumNodeMajor: 24` for compatible updates. Raise the minimum Node version if required. Database schema changes need a separately designed migration and recovery plan; this updater rejects another schema version.
4. Run the backend tests and production frontend build, commit and push the source. Publish a stable GitHub Release for that tested commit if desired. The updater selects the latest stable release; if there are no releases, it checks the default branch. Once stable releases exist, publish a new release for updates rather than relying on changes to the default branch.

Checks resolve the release/branch to a full commit SHA. Preparation downloads that exact commit and verifies its manifest, installs locked dependencies, builds the frontend, and starts it against a temporary empty SQLite database. Passing these checks does not guarantee every business workflow is correct; the provider must test its changes before publishing.

For example, to publish the next version `1.2.1`, change the manifest's version to `1.2.1`, then run from the project root:

```powershell
npm --prefix back version 1.2.1 --no-git-tag-version
git add .
git commit -m "Release SQLite desktop version 1.2.1"
git push origin main
```

Run the checks before committing. `origin` points to the SQLite repository; the original MongoDB project is retained as the `market-cloud` remote. Without GitHub Releases, customers check the latest version on the repository's default branch. Version numbers must increase for an update to become available.

## Data, recovery and storage

The original installation directory remains the launcher entry point. Configuration, `SQLITE_FILE`, Preferences and Atlas credentials resolve to stable absolute paths under that original directory (or explicitly configured locations). They are not overwritten with files from GitHub. Local source edits also remain in the original folder, but the downloaded release becomes the running application.

Prepared applications are in `.market-updates/releases/<job-id>/`. Each job has `.market-updates/jobs/<job-id>/job.json`, a private `prepare.log`, and, after the installation backup, `database.sqlite`. `.market-updates/active.json` selects the running version. These folders, `back/.preferences`, databases, private configuration and Atlas keys are excluded from Git.

The launcher checks the new server's version and SQLite health before resuming writes and sync. If startup fails, it attempts to restore the previous code pointer and the pre-update database snapshot. An interrupted activation is recovered on the next launcher start. Download/build failures leave the running version untouched. Keep a separate customer backup as well: automatic rollback cannot undo an application bug found after successful installation, and disk/hardware failure can prevent recovery.

If automatic recovery fails, stop the launcher, preserve the entire `.market-updates` folder, and consult the job/log before making changes. The native `database.sqlite` backup can be recovered as described in the SQLite guide. Previous releases and recovery backups are retained; no automatic cleanup currently removes them. They can contain customer data and need private storage.

The initial launcher/updater is a protocol-1 component kept in the original installation. Replacing that launcher protocol, adding a database migration, packaging a native Windows installer, or updating Node.js itself requires a separate distribution step.

## Verification

Run `npm run test:updates` in `back` for validation, archive checks, settings flows, real-process restart/rollback and recovery tests. The tests use temporary files and databases.

For the slower local source archive, locked dependency installation, production build and isolated startup test, set `RUN_UPDATE_BUILD_INTEGRATION=1` and run `node --test updates/prepare.integration.test.js`. Git must be available, or `MARKET_TEST_GIT_EXE` must point to its executable. This does not install an update into the real app or use customer data.
