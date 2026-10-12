import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchJson } from '../../api';
import './AtlasSync.css';

const connectionLabels = {
  'not-configured': 'Not connected', waiting: 'Waiting for sync', connecting: 'Connecting',
  connected: 'Atlas reachable', retrying: 'Waiting to retry',
};

function formatDate(value) { return value ? new Date(value).toLocaleString() : 'No successful sync yet'; }

export default function AtlasSync() {
  const [status, setStatus] = useState(null);
  const [uri, setUri] = useState('');
  const [database, setDatabase] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [details, setDetails] = useState({});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [accessKey, setAccessKey] = useState('');
  const [draftAccessKey, setDraftAccessKey] = useState('');
  const hydrated = useRef(false);
  const mounted = useRef(true);

  const request = useCallback((path, options = {}) => fetchJson(`/api/atlas-sync${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(accessKey ? { Authorization: `Bearer ${accessKey}` } : {}) },
  }), [accessKey]);

  const refresh = useCallback(async () => {
    const [next, rows] = await Promise.all([request('/status'), request('/conflicts')]);
    if (!mounted.current) return;
    setStatus(next);
    setConflicts(rows);
    if (!hydrated.current) {
      setDatabase(next.database);
      setEnabled(next.enabled);
      hydrated.current = true;
    }
  }, [request]);

  useEffect(() => {
    mounted.current = true;
    const poll = () => refresh().catch(error => {
      if (mounted.current) setNotice({ type: 'error', text: error.message });
    });
    poll();
    const interval = setInterval(poll, 5000);
    return () => { mounted.current = false; clearInterval(interval); };
  }, [refresh]);

  async function perform(action, operation) {
    setBusy(action);
    setNotice(null);
    try { await operation(); }
    catch (error) {
      setNotice({ type: 'error', text: error.message });
      await refresh().catch(() => {});
    } finally { setBusy(''); }
  }

  async function syncNow() {
    await perform('sync', async () => {
      await request('/sync', { method: 'POST', body: '{}' });
      await refresh();
      setDetails({});
      setNotice({ type: 'success', text: 'Sync check complete. Any conflicting records are listed below.' });
    });
  }

  async function save(event) {
    event.preventDefault();
    await perform('save', async () => {
      const changingTarget = status?.configured && (database !== status.database || uri.trim());
      if (changingTarget && !window.confirm('Saving a different Atlas destination may merge its records with your local data. Continue with these settings?')) return;
      const next = await request('/connection', { method: 'PUT', body: JSON.stringify({
        uri: uri.trim(), database: database.trim(), enabled, confirmTargetChange: Boolean(changingTarget),
      }) });
      setStatus(next);
      setUri('');
      setDetails({});
      setNotice({ type: 'success', text: enabled
        ? 'Connection saved. Automatic sync checks every 30 seconds while the backend is running.'
        : 'Connection saved. Automatic sync is paused; Sync Now is still available.' });
      await refresh();
    });
  }

  async function testConnection() {
    await perform('test', async () => {
      const result = await request('/test', { method: 'POST', body: JSON.stringify({ uri: uri.trim(), database: database.trim() }) });
      setNotice({ type: 'success', text: result.message });
    });
  }

  async function disconnect() {
    if (!window.confirm('Remove the saved Atlas connection and stop automatic sync? Your local and Atlas business data will remain.')) return;
    await perform('disconnect', async () => {
      setStatus(await request('/connection', { method: 'DELETE' }));
      setUri(''); setDatabase(''); setEnabled(false); setConflicts([]); setDetails({});
      setNotice({ type: 'success', text: 'Atlas connection removed.' });
    });
  }

  async function inspect(row) {
    await perform(`inspect-${row.key}`, async () => {
      const detail = await request(`/conflicts/${row.key}`);
      setDetails(current => ({ ...current, [row.key]: detail }));
    });
  }

  async function resolve(row, side) {
    const detail = details[row.key];
    const selected = detail[side];
    if (!window.confirm(selected === null
      ? 'This version is deleted. Delete the record on the other side too?'
      : `Keep the ${side === 'local' ? 'local' : 'Atlas'} version and replace the version on the other side?`)) return;
    await perform(`resolve-${row.key}`, async () => {
      await request(`/conflicts/${row.key}/resolve`, { method: 'POST', body: JSON.stringify({
        side, localHash: detail.localHash, cloudHash: detail.cloudHash,
      }) });
      setDetails(current => { const next = { ...current }; delete next[row.key]; return next; });
      await refresh();
      setNotice({ type: 'success', text: 'Conflict resolved.' });
    });
  }

  const locked = Boolean(busy || status?.running);
  return (
    <div className="atlas-page">
      <header className="atlas-heading">
        <div><p className="atlas-eyebrow">Cloud connection</p><h1>Atlas Sync</h1>
          <p>Keep this installation’s local data and your MongoDB Atlas database in sync.</p></div>
        <Link to="/dashboard" className="atlas-text-link">File backups</Link>
      </header>

      {notice && <p role={notice.type === 'error' ? 'alert' : 'status'} className={`atlas-notice atlas-notice-${notice.type}`}>{notice.text}</p>}

      <section className="atlas-status-grid" aria-label="Sync status">
        <div className="atlas-stat"><span>Connection</span><strong>{status?.running ? 'Sync in progress' : connectionLabels[status?.connection] || 'Loading…'}</strong>
          <small>{status?.configured ? status.host : 'Save your Atlas connection to begin'}</small></div>
        <div className="atlas-stat"><span>Pending local records</span><strong>{status ? status.pending : '—'}</strong><small>Counted during each sync check</small></div>
        <div className="atlas-stat"><span>Conflicts to review</span><strong>{status ? status.conflicts : '—'}</strong><small>Choose which version to keep</small></div>
        <div className="atlas-stat"><span>Last completed sync check</span><strong className="atlas-date">{status ? formatDate(status.lastSyncAt) : '—'}</strong>
          <small>{status?.enabled ? 'Automatic checks every 30 seconds' : 'Automatic sync paused'}</small></div>
      </section>

      {status?.lastError && <p className="atlas-notice atlas-notice-error" role="status">{status.lastError}</p>}
      {status && !status.localConnected && <p className="atlas-notice atlas-notice-error">The local database is disconnected. Start the backend to save business data and sync with Atlas.</p>}

      <section className="atlas-card">
        <h2>Atlas connection</h2>
        <p>Use a dedicated Atlas database for this installation. Give its database user read/write access, and allow this backend computer’s public IP in Atlas Network Access.</p>
        <form onSubmit={save}>
          <label htmlFor="atlas-uri">Atlas connection string</label>
          <input id="atlas-uri" type="password" value={uri} onChange={event => setUri(event.target.value)}
            placeholder={status?.configured ? 'Connection saved — leave blank to keep it' : 'mongodb+srv://username:password@cluster.mongodb.net/'}
            autoComplete="new-password" spellCheck={false} disabled={locked} required={!status?.configured} aria-describedby="atlas-uri-help" />
          <small id="atlas-uri-help">Credentials are encrypted on the backend. The saved connection string is never returned to this page.</small>
          <label htmlFor="atlas-database">Database name</label>
          <input id="atlas-database" value={database} onChange={event => setDatabase(event.target.value)}
            placeholder="market_cloud" autoComplete="off" required disabled={locked} maxLength={63} pattern="[a-zA-Z0-9_-]+" />
          <label className="atlas-checkbox"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={locked} />
            Automatically sync when Atlas is reachable</label>
          <div className="atlas-actions">
            <button type="button" onClick={testConnection} disabled={locked || (!uri && !status?.configured)}>{busy === 'test' ? 'Testing…' : 'Test Connection'}</button>
            <button type="submit" className="atlas-primary" disabled={locked}>{busy === 'save' ? 'Saving…' : 'Save Settings'}</button>
            <button type="button" className="atlas-primary" onClick={syncNow} disabled={locked || !status?.configured || !status?.localConnected}>
              {busy === 'sync' || status?.running ? 'Syncing…' : 'Sync Now'}</button>
            {status?.configured && <button type="button" className="atlas-danger" onClick={disconnect} disabled={locked}>Disconnect</button>}
          </div>
        </form>
      </section>

      <section className="atlas-card">
        <h2>How your data stays in sync</h2>
        <ul className="atlas-explanation">
          <li>Without internet, work continues in local {status?.localEngine === 'sqlite' ? 'SQLite' : 'MongoDB'}. Changes are retried while the backend is running.</li>
          <li>New records merge in both directions. Updates and deletions sync after a shared version has been recorded.</li>
          <li>If both sides change the same record, sync holds that record for your review. Bill number counters keep the higher value.</li>
          <li>Sync copies deletions too. Keep historical backups using <Link to="/dashboard">file backups</Link> or Atlas backup settings.</li>
        </ul>
      </section>

      <section className="atlas-card" aria-labelledby="atlas-conflict-title">
        <h2 id="atlas-conflict-title">Review conflicts</h2>
        {conflicts.length === 0 ? <p>No conflicts to review.</p> : <>
          <p>Review both versions before choosing. Showing up to 100 conflicts.</p>
          <div className="atlas-conflicts">{conflicts.map(row => (
            <article className="atlas-conflict" key={row.key}>
              <div className="atlas-conflict-heading"><div><strong>{row.collection}</strong><code>{row.documentId}</code></div>
                <button type="button" disabled={locked} onClick={() => inspect(row)}>Review versions</button></div>
              {row.message && <p className="atlas-notice atlas-notice-error">{row.message}</p>}
              {details[row.key] && <>
                <div className="atlas-versions">{['local', 'cloud'].map(side => (
                  <div key={side}><h3>{side === 'local' ? 'Local version' : 'Atlas version'}</h3>
                    <pre>{details[row.key][side] === null ? 'Record deleted' : pretty(details[row.key][side])}</pre>
                    <button type="button" disabled={locked} onClick={() => resolve(row, side)}>Keep {side === 'local' ? 'Local' : 'Atlas'}</button></div>
                ))}</div>
              </>}
            </article>
          ))}</div>
        </>}
      </section>

      <details className="atlas-card atlas-access"><summary>Access from another computer</summary>
        <p>If the backend has an ATLAS_SYNC_ADMIN_TOKEN, enter it here. The access key stays in this page’s memory until you leave or reload.</p>
        <form onSubmit={event => { event.preventDefault(); hydrated.current = false; setNotice(null); setAccessKey(draftAccessKey); }}>
          <label htmlFor="atlas-access-key">Settings access key</label>
          <input id="atlas-access-key" type="password" autoComplete="off" value={draftAccessKey} onChange={event => setDraftAccessKey(event.target.value)} />
          <button type="submit" disabled={locked}>Use Access Key</button>
        </form>
      </details>
    </div>
  );
}

function pretty(value) { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
