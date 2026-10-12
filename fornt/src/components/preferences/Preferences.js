import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchJson } from '../../api';
import './Preferences.css';

const WORKING = ['queued', 'downloading', 'building', 'testing', 'backing-up', 'restarting'];

export default function Preferences() {
  const [status, setStatus] = useState(null);
  const [repository, setRepository] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [draftKey, setDraftKey] = useState('');
  const initialized = useRef(false);
  const restarting = useRef(false);
  const mounted = useRef(true);
  const request = useCallback((path = '', options = {}) => fetchJson(`/api/preferences${path}`, {
    ...options, headers: { 'Content-Type': 'application/json', ...(accessKey ? { Authorization: `Bearer ${accessKey}` } : {}) },
  }), [accessKey]);
  const accept = useCallback(next => {
    if (!mounted.current) return;
    setStatus(next);
    if (!initialized.current) { setRepository(next.repository); initialized.current = true; }
    if (restarting.current && ['installed', 'rolled-back'].includes(next.job?.phase)) {
      restarting.current = false;
      window.location.reload();
    }
    if (restarting.current && next.job?.phase === 'failed') {
      restarting.current = false;
      setNotice({ type: 'error', text: next.job.message });
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => request().then(accept).catch(error => {
      if (mounted.current) setNotice({ type: restarting.current ? 'info' : 'error', text: restarting.current
        ? 'Waiting for the application to restart. This page will reconnect automatically.' : error.message });
    });
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => { mounted.current = false; clearInterval(interval); };
  }, [request, accept]);

  async function perform(name, path, body) {
    setBusy(name); setNotice(null);
    try { accept(await request(path, { method: name === 'save' ? 'PUT' : 'POST', body: JSON.stringify(body) })); }
    catch (error) { restarting.current = false; setNotice({ type: 'error', text: error.message }); }
    finally { setBusy(''); }
  }
  function install() {
    if (!window.confirm(`Install version ${status.job.version} from ${status.repository}?\n\nSave unfinished bills first. The app will back up your database and restart. Only install software from a repository you trust.`)) return;
    restarting.current = true;
    void perform('install', '/install', { id: status.job.id, commit: status.job.commit });
  }
  const working = Boolean(busy || WORKING.includes(status?.job?.phase));
  const prepared = status?.job?.phase === 'prepared';
  const repositoryChanged = repository.trim() !== status?.repository;
  return <div className="preferences-page">
    <header className="preferences-heading"><p>Application settings</p><h1>Preferences</h1>
      <span>Manage your local installation and software updates.</span></header>
    {notice && <p role={notice.type === 'error' ? 'alert' : 'status'} className={`preferences-notice ${notice.type}`}>{notice.text}</p>}
    <section className="preferences-card preferences-summary" aria-label="Installation settings">
      <div><span>Installed version</span><strong>{status?.installedVersion || 'Loading…'}</strong></div>
      <div><span>Database</span><strong>{status ? status.engine === 'sqlite' ? 'SQLite · local desktop' : 'MongoDB' : 'Loading…'}</strong></div>
      <div className="preferences-links"><Link to="/dashboard">Backup &amp; restore</Link><Link to="/atlas-sync">Cloud synchronization</Link></div>
    </section>
    <section className="preferences-card">
      <h2>Software updates</h2>
      <p>Enter the public GitHub repository supplied by your software provider. Updates are prepared separately before your current app is restarted.</p>
      <form onSubmit={event => { event.preventDefault(); void perform('save', '/repository', { repository: repository.trim() }); }}>
        <label htmlFor="update-repository">GitHub repository link</label>
        <input id="update-repository" type="url" value={repository} onChange={event => setRepository(event.target.value)}
          placeholder="https://github.com/owner/repository" required disabled={working || prepared} autoComplete="off" />
        <div className="preferences-actions">
          <button type="submit" disabled={working || prepared}>{busy === 'save' ? 'Saving…' : 'Save Repository'}</button>
          <button type="button" disabled={working || prepared || !status || repositoryChanged}
            onClick={() => perform('check', '/check', {})}>{busy === 'check' ? 'Checking…' : 'Check for Updates'}</button>
        </div>
      </form>
      {status && !status.canInstall && <p className="preferences-notice info">Software installation is available in the managed SQLite desktop edition.
        Start it with <code>npm run start:sqlite</code> on the local computer.</p>}
      {status?.latest && <div className="preferences-release">
        <div><h3>{status.latest.name}</h3><span>Version {status.latest.manifest.version}</span></div>
        <p>{status.updateAvailable ? 'A newer compatible version is available.' : 'Your installed version is current or newer.'}</p>
        {status.latest.notes && <pre>{status.latest.notes}</pre>}
        <a href={status.latest.url} target="_blank" rel="noreferrer">View update on GitHub</a>
        {status.updateAvailable && !prepared && <div className="preferences-actions"><button type="button" className="primary"
          disabled={working || !status.canInstall || repositoryChanged} onClick={() => perform('prepare', '/prepare', { commit: status.latest.commit })}>
          Prepare Update</button></div>}
      </div>}
      {status?.job && <div className="preferences-job" role="status">
        <strong>Update {status.job.version} · {status.job.phase.replaceAll('-', ' ')}</strong>
        <p>{status.job.message}</p>
        {status.job.backupCreated && <p>A database recovery backup was created before restarting.</p>}
        {prepared && <div className="preferences-actions">
          <button type="button" className="primary" disabled={working || !status.canInstall} onClick={install}>Install and Restart</button>
          <button type="button" disabled={working} onClick={() => perform('cancel', '/cancel', { id: status.job.id })}>Cancel Update</button>
        </div>}
      </div>}
    </section>
    <section className="preferences-card"><h2>What an update preserves</h2><ul>
      <li>Your SQLite billing database is backed up before the app restarts.</li>
      <li>Database location, private configuration and Atlas connection settings stay outside downloaded application versions.</li>
      <li>If the new version fails its startup check, the launcher attempts to restore the previous app and database.</li>
    </ul></section>
    <details className="preferences-card"><summary>Settings access key</summary>
      <p>If this computer has a settings access key, enter it here. It is kept only in this page’s memory.</p>
      <form onSubmit={event => { event.preventDefault(); setNotice(null); initialized.current = false; setAccessKey(draftKey); }}>
        <label htmlFor="preferences-key">Access key</label><input id="preferences-key" type="password" value={draftKey}
          onChange={event => setDraftKey(event.target.value)} autoComplete="off" />
        <button type="submit">Use Access Key</button>
      </form>
    </details>
  </div>;
}
