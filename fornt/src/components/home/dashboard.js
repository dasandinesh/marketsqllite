import React, { useCallback, useEffect, useRef, useState } from 'react';
import './dashboard.css';

const CHECK_INTERVAL_MS = 15000;

// state: 'pending' (gray, still checking) | 'ok' (green) | 'bad' (red)
const StatusLight = ({ label, state, detail }) => (
  <div className="status-card">
    <span className={`status-dot status-${state}`} aria-hidden="true" />
    <div className="status-text">
      <div className="status-label">{label}</div>
      <div className="status-detail">{detail}</div>
    </div>
  </div>
);

// ---- Business overview helpers ----
const num = (v) => Number(v) || 0;
const money = (v) => `₹${num(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// Local calendar date as yyyy-mm-dd.
const dateString = (d) => {
  const copy = new Date(d);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().split('T')[0];
};

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
];

const periodRange = (id) => {
  const today = new Date();
  const end = dateString(today);
  if (id === 'week') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start: dateString(start), end };
  }
  if (id === 'month') return { start: dateString(new Date(today.getFullYear(), today.getMonth(), 1)), end };
  return { start: end, end };
};

// Sum a value per key and return the top N as [{ name, value }].
const topBy = (items, keyFn, valueFn, n = 5) => {
  const totals = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    totals.set(key, (totals.get(key) || 0) + valueFn(item));
  });
  return Array.from(totals, ([name, value]) => ({ name, value }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
};

const StatTile = ({ label, value, note, tone }) => (
  <div className={`stat-tile${tone ? ` stat-${tone}` : ''}`}>
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
    {note && <div className="stat-note">{note}</div>}
  </div>
);

const RankList = ({ title, rows, format, empty }) => (
  <div className="rank-card">
    <h3>{title}</h3>
    {rows.length ? (
      <ol className="rank-list">
        {rows.map((row) => (
          <li key={row.name}>
            <span className="rank-name">{row.name}</span>
            <span className="rank-value">{format(row.value)}</span>
          </li>
        ))}
      </ol>
    ) : (
      <p className="rank-empty">{empty}</p>
    )}
  </div>
);

const BusinessOverview = () => {
  const [period, setPeriod] = useState('today');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { start, end } = periodRange(period);
    const qs = `startDate=${start}&endDate=${end}`;
    setLoading(true);
    setError('');
    try {
      const responses = await Promise.all([
        fetch(`/api/sales?${qs}`),
        fetch(`/api/orders?${qs}`),
        fetch(`/api/receipts?${qs}`),
        fetch('/api/customers'),
      ]);
      if (responses.some((r) => !r.ok)) throw new Error('Unable to load business data.');
      const [sales, orders, receipts, customers] = await Promise.all(responses.map((r) => r.json()));
      setData({ sales, orders, receipts, customers });
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const sales = data?.sales || [];
  const orders = data?.orders || [];
  const receipts = data?.receipts || [];
  const customers = data?.customers || [];

  const salesTotal = sales.reduce((t, s) => t + num(s.bill_details?.bill_amount), 0);
  const ordersTotal = orders.reduce((t, o) => t + num(o.bill_details?.bill_amount), 0);
  const paidOnBills = sales.reduce((t, s) => t + num(s.bill_details?.debit) + num(s.bill_details?.credit), 0);
  const receiptTotal = receipts.reduce((t, r) => t + num(r.amount), 0);
  const collected = paidOnBills + receiptTotal;
  const pendingSales = sales.filter((s) => !s.bill_details?.billed).length;
  const bagsSold = sales.reduce((t, s) => t + num(s.bill_details?.bag_quantity), 0);
  const outstanding = customers.reduce((t, c) => t + Math.max(0, num(c.oldBalance)), 0);
  const customersWithDues = customers.filter((c) => num(c.oldBalance) > 0).length;

  const saleLines = sales.flatMap((s) => s.products || []);
  const topCustomers = topBy(sales, (s) => s.customer?.name, (s) => num(s.bill_details?.bill_amount));
  const topProductsByAmount = topBy(saleLines, (p) => p.name, (p) => num(p.base_price));
  const topProductsByQty = topBy(saleLines, (p) => p.name, (p) => num(p.quantity));
  const topDues = customers
    .filter((c) => num(c.oldBalance) > 0)
    .sort((a, b) => num(b.oldBalance) - num(a.oldBalance))
    .slice(0, 5)
    .map((c) => ({ name: c.name, value: num(c.oldBalance) }));

  const { start, end } = periodRange(period);

  return (
    <section className="dashboard-card">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-eyebrow">Business overview</p>
          <h1>Sales &amp; collections</h1>
          <p>{start === end ? start : `${start} to ${end}`}</p>
        </div>
        <div className="period-tabs" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={period === p.id}
              className={`period-tab${period === p.id ? ' is-active' : ''}`}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="backup-status backup-status-error">{error}</p>}

      <div className={`stat-grid${loading ? ' is-loading' : ''}`}>
        <StatTile label="Sales" value={money(salesTotal)} note={`${sales.length} bill(s) · ${bagsSold} bag(s)`} />
        <StatTile label="Collected" value={money(collected)} note={`Bills ${money(paidOnBills)} · Receipts ${money(receiptTotal)}`} tone="good" />
        <StatTile label="Orders (purchase)" value={money(ordersTotal)} note={`${orders.length} order(s)`} />
        <StatTile label="Pending sale bills" value={pendingSales} note="Not yet confirmed" tone={pendingSales ? 'warn' : undefined} />
        <StatTile label="Total outstanding" value={money(outstanding)} note={`${customersWithDues} customer(s) owe money · all time`} tone={outstanding ? 'warn' : undefined} />
      </div>

      <div className="rank-grid">
        <RankList title="Top customers" rows={topCustomers} format={money} empty="No sales in this period." />
        <RankList title="Top products by amount" rows={topProductsByAmount} format={money} empty="No sales in this period." />
        <RankList title="Top products by quantity" rows={topProductsByQty} format={(v) => v.toLocaleString('en-IN')} empty="No sales in this period." />
        <RankList title="Highest dues" rows={topDues} format={money} empty="No customer owes money." />
      </div>
    </section>
  );
};

const Dashboard = () => {
  // Frontend: this component rendering at all means the React app is up — always green.
  const [backendState, setBackendState] = useState('pending');
  const [dbState, setDbState] = useState('pending');
  const [dbEngine, setDbEngine] = useState('');
  const [checking, setChecking] = useState(true);
  const [lastChecked, setLastChecked] = useState(null);

  const fileInputRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backupStatus, setBackupStatus] = useState({ type: '', text: '' });

  const checkHealth = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch('/api/health');
      if (!response.ok) throw new Error(`Health check failed (${response.status})`);
      const data = await response.json();
      setBackendState('ok');
      setDbState(data.db ? 'ok' : 'bad');
      setDbEngine(data.engine || 'mongodb');
    } catch {
      // Backend unreachable — database status can't be confirmed either.
      setBackendState('bad');
      setDbState('bad');
    } finally {
      setLastChecked(new Date());
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const timer = setInterval(checkHealth, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [checkHealth]);

  const downloadBackup = async (nativeSQLite = false) => {
    setDownloading(true);
    setBackupStatus({ type: '', text: '' });
    try {
      const response = await fetch(nativeSQLite ? '/api/backup/download-sqlite' : '/api/backup/download');
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Backup download failed (${response.status}).`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `market-backup-${Date.now()}.json`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setBackupStatus({ type: 'success', text: `Backup downloaded as ${filename}.` });
    } catch (error) {
      setBackupStatus({ type: 'error', text: error.message });
    } finally {
      setDownloading(false);
    }
  };

  const handleRestoreFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file again later
    if (!file) return;

    const confirmed = window.confirm(
      `Restore from "${file.name}"?\n\nThis REPLACES all current data in every collection found in the file. This cannot be undone.`
    );
    if (!confirmed) return;

    setRestoring(true);
    setBackupStatus({ type: '', text: '' });
    try {
      const text = await file.text();
      const response = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: text,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Restore failed (${response.status}).`);

      const totalDocs = (data.summary || []).reduce((sum, s) => sum + s.restored, 0);
      setBackupStatus({
        type: 'success',
        text: `Restore complete — ${data.summary.length} collection(s), ${totalDocs} document(s).`,
      });
      checkHealth();
    } catch (error) {
      setBackupStatus({ type: 'error', text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <main className="dashboard-page">
      <BusinessOverview />

      <section className="dashboard-card dashboard-backup">
        <header className="dashboard-header">
          <div>
            <p className="dashboard-eyebrow">System status</p>
            <h1>Dashboard</h1>
            <p>Frontend, backend, and database — green when healthy, red when not.</p>
          </div>
          <button type="button" className="dashboard-refresh" onClick={checkHealth} disabled={checking}>
            {checking ? 'Checking…' : 'Refresh'}
          </button>
        </header>

        <div className="status-grid">
          <StatusLight label="Frontend" state="ok" detail="React app is running" />
          <StatusLight
            label="Backend"
            state={backendState}
            detail={backendState === 'pending' ? 'Checking…' : backendState === 'ok' ? 'API reachable' : 'API unreachable'}
          />
          <StatusLight
            label="Database"
            state={dbState}
            detail={dbState === 'pending' ? 'Checking…' : dbState === 'ok' ? `${dbEngine === 'sqlite' ? 'SQLite' : 'MongoDB'} connected` : 'Disconnected'}
          />
        </div>

        {lastChecked && (
          <p className="dashboard-updated">Last checked {lastChecked.toLocaleTimeString()} · rechecks every 15s</p>
        )}
      </section>

      <section className="dashboard-card dashboard-backup">
        <header className="dashboard-header">
          <div>
            <p className="dashboard-eyebrow">Data backup</p>
            <h1>Backup &amp; restore</h1>
            <p>Download every collection as one file, or restore the database from a backup file.</p>
          </div>
        </header>

        <div className="backup-actions">
          <button type="button" className="dashboard-refresh" onClick={() => downloadBackup()} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download backup'}
          </button>
          {dbEngine === 'sqlite' && <button type="button" className="dashboard-refresh" onClick={() => downloadBackup(true)} disabled={downloading || restoring}>
            Download SQLite file
          </button>}
          <button
            type="button"
            className="dashboard-refresh dashboard-refresh-danger"
            onClick={() => fileInputRef.current?.click()}
            disabled={restoring}
          >
            {restoring ? 'Restoring…' : 'Restore from backup'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleRestoreFile}
            hidden
          />
        </div>

        <p className="backup-warning">
          Restoring replaces the current data in every collection found in the chosen file. This cannot be undone —
          take a fresh backup first if you're not sure.
        </p>

        {backupStatus.text && (
          <p className={`backup-status backup-status-${backupStatus.type || 'info'}`}>{backupStatus.text}</p>
        )}
      </section>
    </main>
  );
};

export default Dashboard;
