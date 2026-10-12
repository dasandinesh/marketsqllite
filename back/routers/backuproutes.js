const express = require('express');
const router = express.Router();
const controller = require('../controllers/backupcontroller');

router.get('/download', controller.downloadBackup);
router.get('/download-sqlite', controller.downloadSQLite);

// Raw text body (NOT express.json()) so the Extended JSON $oid / $date markers reach
// the controller untouched instead of being flattened into plain nested objects.
router.post('/restore', express.text({ type: '*/*', limit: '80mb' }), controller.restoreBackup);

module.exports = router;
