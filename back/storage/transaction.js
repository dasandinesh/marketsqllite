const { engine } = require('./index');

// Buffer JSON until COMMIT: a sale's counter, bill and balance either all persist
// or all roll back. The queue also keeps other requests from reading partial data.
exports.wrapControllers = controllers => {
  if (engine() !== 'sqlite') return controllers;
  return Object.fromEntries(Object.entries(controllers).map(([name, handler]) => [name, async (req, res, next) => {
    if (['GET', 'HEAD'].includes(req.method)) return handler(req, res, next);
    const send = res.json;
    let response;
    const rejected = new Error('Controller rejected the write.');
    try {
      await require('./sqlite').getStore().transaction(async () => {
        res.json = function json(body) { response = body; return this; };
        await handler(req, res, next);
        if (res.statusCode >= 400) throw rejected;
        if (req.aborted) throw new Error('Request was cancelled.');
      });
      res.json = send;
      return res.json(response);
    } catch (error) {
      res.json = send;
      if (error === rejected) return res.json(response);
      return res.status(500).json({ error: 'SQLite operation failed; no changes were saved.' });
    }
  }]));
};
