const express = require('express');
const crypto = require('node:crypto');
const { service } = require('./service');

module.exports = function createRouter(preferences = service) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
      return res.status(403).json({ error: 'Software updates must be managed on the local computer.' });
    }
    if (req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { return res.status(403).json({ error: 'Invalid request origin.' }); }
      if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) return res.status(403).json({ error: 'Open Preferences on localhost to manage updates.' });
    }
    const token = process.env.ATLAS_SYNC_ADMIN_TOKEN;
    if (token) {
      const actual = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, '')); const expected = Buffer.from(token);
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'Enter the settings access key configured on this computer.' });
    }
    if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'Use a JSON request for update actions.' });
    next();
  });
  const handle = fn => async (req, res) => {
    try { res.json(await fn(req)); } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Software update settings are unavailable. Check the local update log.' }); }
  };
  router.get('/', handle(() => preferences.status()));
  router.put('/repository', handle(req => preferences.save(req.body?.repository)));
  router.post('/check', handle(() => preferences.check()));
  router.post('/prepare', handle(req => preferences.prepare(req.body?.commit)));
  router.post('/install', handle(req => preferences.install(req.body?.id, req.body?.commit)));
  router.post('/cancel', handle(req => preferences.cancel(req.body?.id)));
  return router;
};
