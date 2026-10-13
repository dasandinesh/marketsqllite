const crypto = require('node:crypto');
const { UpdateError } = require('./files');
// Only the Electron parent owns installer downloads and restart decisions.
class DesktopPreferences {
  constructor(channel = process) {
    this.channel = channel; this.pending = new Map();
    channel.on('message', message => {
      if (message?.type !== 'desktop-preferences-result') return;
      const request = this.pending.get(message.requestId);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(message.requestId);
      if (message.error) request.reject(new UpdateError(message.error, message.status || 400));
      else request.resolve(message.result);
    });
  }
  request(action, args = []) {
    return new Promise((resolve, reject) => {
      if (!this.channel.connected) { reject(new UpdateError('The desktop application is disconnected.', 503)); return; }
      const requestId = crypto.randomBytes(16).toString('hex');
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new UpdateError('Desktop settings timed out. Retry after checking your internet connection.', 504)); }, 90000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.channel.send({ type: 'desktop-preferences', requestId, action, args }, error => {
        if (error) { clearTimeout(timer); this.pending.delete(requestId); reject(new UpdateError('Desktop settings are unavailable.', 503)); }
      });
    });
  }
  status() { return this.request('status'); }
  save(repository) { return this.request('save', [repository]); }
  check() { return this.request('check'); }
  prepare(commit) { return this.request('prepare', [commit]); }
  install(id, commit) { return this.request('install', [id, commit]); }
  cancel(id) { return this.request('cancel', [id]); }
}
module.exports = { DesktopPreferences };
