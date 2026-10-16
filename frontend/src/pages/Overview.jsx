import { useState, useEffect, useCallback } from 'react';
import { ordersStats, clientsList, clientStores, pollLogs } from '../api/client';

// ── Icons ─────────────────────────────────────────────────────────────────────
const IconRefresh = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
  </svg>
);
const IconOrders = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
  </svg>
);
const IconStore = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);
const IconClients = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
  </svg>
);
const IconPending = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
const IconSent = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconFailed = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
);
const IconActivity = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
);
const IconBell = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
  </svg>
);
const IconSettings = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
);
const IconDot = ({ color }) => (
  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
);

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function pollDuration(log) {
  if (!log.startedAt || !log.finishedAt) return null;
  const ms = new Date(log.finishedAt) - new Date(log.startedAt);
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Skeleton({ w = '100%', h = 28, r = 6 }) {
  return <span className="ov2-skeleton" style={{ width: w, height: h, borderRadius: r }} />;
}

function PrimaryCard({ label, value, icon, accent, loading }) {
  return (
    <div className="ov2-primary-card" style={{ '--ov-accent': accent }}>
      <div className="ov2-primary-card-top">
        <div className="ov2-primary-icon">{icon}</div>
        <span className="ov2-primary-label">{label}</span>
      </div>
      <div className="ov2-primary-value">
        {loading ? <Skeleton w={64} h={36} /> : fmt(value)}
      </div>
    </div>
  );
}

function MiniStat({ label, value, icon, color, loading }) {
  return (
    <div className="ov2-mini-stat">
      <div className="ov2-mini-icon" style={{ color }}>{icon}</div>
      <div className="ov2-mini-body">
        <span className="ov2-mini-label">{label}</span>
        <span className="ov2-mini-value" style={{ color }}>
          {loading ? <Skeleton w={32} h={20} /> : fmt(value)}
        </span>
      </div>
    </div>
  );
}

function SuccessRate({ stats, loading }) {
  const total = stats?.total ?? 0;
  const sent  = stats?.sent  ?? 0;
  const pct   = total > 0 ? Math.round((sent / total) * 100) : 0;

  return (
    <div className="ov2-rate-card">
      <div className="ov2-rate-header">
        <span className="ov2-rate-label">Order Success Rate</span>
        <span className="ov2-rate-pct" style={{ color: pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)' }}>
          {loading ? '—' : `${pct}%`}
        </span>
      </div>
      <div className="ov2-rate-bar-track">
        <div
          className="ov2-rate-bar-fill"
          style={{
            width: loading ? '0%' : `${pct}%`,
            background: pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)',
          }}
        />
      </div>
      <div className="ov2-rate-legend">
        <span><IconDot color="var(--success)" /> {fmt(stats?.sent)} sent</span>
        <span><IconDot color="var(--warn)" /> {fmt(stats?.pending)} pending</span>
        <span><IconDot color="var(--danger)" /> {fmt(stats?.failed)} failed</span>
      </div>
    </div>
  );
}

function ClientRow({ c, storeCount }) {
  return (
    <div className="ov2-client-row">
      <div className="ov2-client-avatar" style={{ background: c.isActive ? 'var(--accent)' : 'var(--text-tertiary)' }}>
        {c.name.slice(0, 2).toUpperCase()}
      </div>
      <div className="ov2-client-info">
        <span className="ov2-client-name">{c.name}</span>
        <code className="ov2-client-slug">{c.slug}</code>
      </div>
      <div className="ov2-client-right">
        {storeCount != null && (
          <span className="ov2-store-count">
            <IconStore /> {storeCount}
          </span>
        )}
        <span className={`ov2-badge${c.isActive ? ' active' : ''}`}>
          {c.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>
    </div>
  );
}

function PollRow({ log }) {
  const statusColor = { ok: 'var(--success)', error: 'var(--danger)', running: 'var(--warn)' }[log.status] ?? 'var(--text-tertiary)';
  const duration = pollDuration(log);

  return (
    <div className="ov2-poll-row">
      <div className="ov2-poll-dot-col">
        <IconDot color={statusColor} />
        <div className="ov2-poll-line" />
      </div>
      <div className="ov2-poll-body">
        <div className="ov2-poll-top">
          <span className="ov2-poll-time">{timeAgo(log.startedAt)}</span>
          <span className="ov2-poll-status" style={{ color: statusColor }}>
            {log.status === 'ok' ? 'Done' : log.status === 'error' ? 'Error' : 'Running'}
          </span>
          {duration && <span className="ov2-poll-dur">{duration}</span>}
        </div>
        <div className="ov2-poll-counts">
          <span><b>{log.ordersFound ?? 0}</b> found</span>
          <span><b>{log.ordersProcessed ?? 0}</b> processed</span>
          {log.ordersSkipped > 0 && <span className="ov2-poll-skipped"><b>{log.ordersSkipped}</b> skipped</span>}
          {log.error && <span className="ov2-poll-error" title={log.error}>⚠ error</span>}
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Overview() {
  const [stats,       setStats]       = useState(null);
  const [clients,     setClients]     = useState([]);
  const [storeCounts, setStoreCounts] = useState({});
  const [logs,        setLogs]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [statsRes, clientsRes, logsRes] = await Promise.allSettled([
        ordersStats(),
        clientsList(),
        pollLogs(10),
      ]);
      if (statsRes.status   === 'fulfilled') setStats(statsRes.value);
      if (logsRes.status    === 'fulfilled') setLogs(logsRes.value.logs ?? []);
      if (clientsRes.status === 'fulfilled') {
        const list = clientsRes.value.data ?? [];
        setClients(list);
        const counts = {};
        await Promise.allSettled(
          list.map(async c => {
            try {
              const r = await clientStores(c.id);
              counts[c.id] = r.data?.length ?? 0;
            } catch { counts[c.id] = 0; }
          })
        );
        setStoreCounts(counts);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeClients = clients.filter(c => c.isActive).length;
  const totalStores   = Object.values(storeCounts).reduce((s, n) => s + n, 0);

  return (
    <div className="dashboard">
      {/* ── Header ── */}
      <div className="ov2-header">
        <div>
          <h1 className="ov2-title">Overview</h1>
          <p className="ov2-subtitle">System status and activity at a glance</p>
        </div>
        <div className="ov2-header-actions">
          <button className="ov2-refresh-btn" onClick={() => load(true)} disabled={refreshing || loading}>
            <span className={refreshing ? 'ov2-spin' : ''}><IconRefresh /></span>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="ov2-icon-btn" title="Notifications"><IconBell /></button>
          <button className="ov2-icon-btn" title="Settings"><IconSettings /></button>
          <div className="ov2-avatar">A</div>
        </div>
      </div>

      {/* ── Primary stats ── */}
      <div className="ov2-primary-row">
        <PrimaryCard label="Total Orders"     value={stats?.total} icon={<IconOrders />}  accent="var(--accent)"   loading={loading} />
        <PrimaryCard label="Active Clients"   value={activeClients} icon={<IconClients />} accent="var(--blue)"     loading={loading} />
        <PrimaryCard label="Connected Stores" value={totalStores}   icon={<IconStore />}   accent="var(--success)"  loading={loading} />
      </div>

      {/* ── Status row ── */}
      <div className="ov2-status-row">
        <MiniStat label="Pending" value={stats?.pending} icon={<IconPending />} color="var(--warn)"    loading={loading} />
        <MiniStat label="Sent"    value={stats?.sent}    icon={<IconSent />}    color="var(--success)" loading={loading} />
        <MiniStat label="Failed"  value={stats?.failed}  icon={<IconFailed />}  color="var(--danger)"  loading={loading} />
        <SuccessRate stats={stats} loading={loading} />
      </div>

      {/* ── Body ── */}
      <div className="ov2-body">
        {/* Clients */}
        <div className="ov2-panel">
          <div className="ov2-panel-head">
            <span className="ov2-panel-title">Clients</span>
            {clients.length > 0 && <span className="ov2-panel-chip">{clients.length}</span>}
          </div>
          {loading ? (
            <div className="ov2-panel-loading"><div className="spinner" /></div>
          ) : clients.length === 0 ? (
            <div className="ov2-empty">
              <IconClients />
              <p>No clients yet</p>
            </div>
          ) : (
            <div className="ov2-client-list">
              {clients.map(c => (
                <ClientRow key={c.id} c={c} storeCount={storeCounts[c.id]} />
              ))}
            </div>
          )}
        </div>

        {/* Poll Runs */}
        <div className="ov2-panel">
          <div className="ov2-panel-head">
            <span className="ov2-panel-title">
              <IconActivity /> Recent Poll Runs
            </span>
            {logs.length > 0 && <span className="ov2-panel-chip">{logs.length}</span>}
          </div>
          {loading ? (
            <div className="ov2-panel-loading"><div className="spinner" /></div>
          ) : logs.length === 0 ? (
            <div className="ov2-empty">
              <IconActivity />
              <p>No poll runs yet</p>
              <span className="ov2-empty-sub">Historical poll activity will appear here once processing starts.</span>
            </div>
          ) : (
            <div className="ov2-poll-list">
              {logs.map(l => <PollRow key={l.id} log={l} />)}
            </div>
          )}
        </div>
      </div>


    </div>
  );
}
