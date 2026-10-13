# Windows SQLite installer

This edition packages the React frontend, local SQLite backend, Electron window and Node.js runtime into one offline-capable Windows installer. Customers do not need Git, npm, Node.js or MongoDB Server. The target is **Windows 10/11 x64**; Windows ARM64 and other operating systems need separate builds and testing.

## Install and use

Run `Market-Billing-Setup-1.3.1-x64.exe`. The per-user one-click installer creates **Market Billing** desktop and Start Menu shortcuts and launches the application. Local billing works without internet. Internet is needed for optional Atlas sync and software update downloads.

No code-signing certificate is configured for this initial build. Windows may display an unknown-publisher/SmartScreen warning. The publisher should sign public production installers with its own Windows code-signing certificate. Do not claim that the unsigned installer avoids security prompts.

SQLite data, private configuration, Preferences, Atlas settings and update backups are stored under `%APPDATA%\Market Billing\`, outside application binaries. Use **File → Open data folder** to locate them. Uninstalling retains this folder. Keep business backups separately and import an existing source installation's JSON export through **Dashboard → Restore from backup**; no customer's current database is bundled or imported automatically.

The backend listens only on an automatically chosen loopback port and is managed by the desktop app. Closing the application stops billing and background sync. One desktop instance per user-data folder is allowed. Print popups, PDF/backup downloads, zoom and keyboard shortcuts remain available.

## Software updates

Open **Preferences**, keep or enter `https://github.com/dasandinesh/marketsqllite`, then use **Check for Updates → Download Update → Install and Restart**. The customer downloads a ready-made Windows installer; no source build or npm runs on their PC.

The publisher must create a stable GitHub Release with the version's complete source, compatible `market-update.json`, and all three build outputs: setup `.exe`, `.exe.blockmap` and `latest.yml`. A source push alone does not publish an installer update. The updater checks manifest compatibility, matching versions and installer download checksums. The app pauses writes/sync, waits for current work, and creates a native SQLite backup before starting the installer. Startup verifies database health before resuming.

For installer updates, a failed new-app startup attempts to restore the pre-update database and keeps its backup. It cannot automatically reinstall the old binary; reinstall the previous setup file if required. Retain previous installers and independent customer backups. Source installations retain their existing separate-copy update/automatic code rollback flow.

## Build on Windows x64

Install Node.js 24+ and npm on the **publisher's build computer**. From the project root:

```powershell
cd fornt
npm ci
cd ../desktop
npm ci
node node_modules/electron/install.js
npm run build:win
npm run test:packaged
```

The explicit Electron install step handles npm versions that block dependency installation scripts. The NSIS target does not use electron-winstaller. The build copies only backend `.js`/`.json` application files and locked production dependencies, creates a fresh frontend build, and bundles the build machine's x64 Node executable. It excludes customer databases, private `.env` files, sync credentials, preferences and test fixtures. Build output is in `dist/desktop/`; `win-unpacked/` is for QA and is not a standalone distributable executable.

Run `npm test` in `desktop` for installer selection and IPC tests. `npm run test:packaged` launches the packaged app twice with an isolated temporary SQLite database and a PATH without Node/npm, checks React rendering and sandboxing, creates a customer, verifies persistence on restart, and checks normal/update native backups. It does not install into or use the real customer's app-data folder.

For each release, set the same increasing version in `market-update.json`, `back/package.json`, `desktop/package.json`, and both corresponding package-lock root entries. A change to the SQLite database schema needs a migration/recovery design; the current updater accepts schema 1 only.

## Publish releases

The repository includes a Windows GitHub Actions workflow. After committing and pushing the tested changes, push a matching tag such as `v1.3.1`. The workflow builds and tests, then creates a stable GitHub Release with installer assets. It uses GitHub's workflow token, never a customer password. If code signing is desired, configure publisher signing credentials before distribution; the current workflow builds unsigned.

For manual publishing, upload the setup executable, its blockmap and `latest.yml` together to the stable Release for the tested tag. Keep the source manifest at that exact tag in agreement with the installer version. Do not replace published assets under the same version number; increase the version for changes.
