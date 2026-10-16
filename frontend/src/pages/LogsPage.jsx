import { useState, useEffect, useRef, useCallback } from 'react';
import { systemLogs, systemLogsClear } from '../api/client';

const LEVELS = [
  { key: 'all',   label: 'All' },
  { key: 'info',  label: 'Info' },
  { key: 'warn',  label: 'Warnings' },
  { key: 'error', label: 'Errors' },
];

function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export default function LogsPage() {
  const [logs, setLogs]       = useState([]);
  const [level, setLevel]     = useState('all');
  const [search, setSearch]   = useState('');
  const [live, setLive]       = useState(true);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(true);

  const lastIdRef    = useRef(0);
  const viewportRef  = useRef(null);
  const atBottomRef  = useRef(true);

  // Full (re)load — used on mount and whenever the filters change.
  const loadFull = useCallback(async () => {
    setLoading(true);
    try {
      const res = await systemLogs({ level, search, limit: 1000 });
      setLogs(res.logs ?? []);
      lastIdRef.current = res.lastId ?? 0;
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [level, search]);

  // Incremental fetch — only entries newer than the last id we have.
  const loadIncremental = useCallback(async () => {
    try {
      const res = await systemLogs({ level, search, sinceId: lastIdRef.current, limit: 1000 });
      if (res.logs?.length) {
        lastIdRef.current = res.lastId ?? lastIdRef.current;
        setLogs((prev) => {
          const merged = [...prev, ...res.logs];
          return merged.length > 2000 ? merged.slice(merged.length - 2000) : merged;
        });
      }
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load logs');
    }
  }, [level, search]);

  // Reload from scratch when filters change (debounced for the search box).
  useEffect(() => {
    const t = setTimeout(loadFull, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadFull, search]);

  // Live tail.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(loadIncremental, 2000);
    return () => clearInterval(id);
  }, [live, loadIncremental]);

  // Keep the viewport pinned to the bottom while tailing.
  useEffect(() => {
    if (atBottomRef.current && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [logs]);

  function onScroll() {
    const el = viewportRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  async function handleClear() {
    if (!window.confirm('Clear the in-memory log buffer? (Terminal/PM2 output is unaffected.)')) return;
    try {
      await systemLogsClear();
      setLogs([]);
      lastIdRef.current = 0;
    } catch (err) {
      setError(err.message || 'Failed to clear logs');
    }
  }

  function handleDownload() {
    const text = logs.map((l) => `${l.ts} [${l.level.toUpperCase()}] ${l.msg}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `salla-hub-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const counts = logs.reduce((acc, l) => { acc[l.level] = (acc[l.level] || 0) + 1; return acc; }, {});

  return (
    <div className="dashboard">
      <header className="ov-header">
        <div>
          <h1>Server Logs</h1>
          <p>Live output from the backend process — poller, token refresh, and API activity</p>
        </div>
        <div className="logs-header-actions">
          <button
            type="button"
            className={`logs-live-btn${live ? ' is-live' : ''}`}
            onClick={() => setLive((v) => !v)}
            title={live ? 'Pause live tail' : 'Resume live tail'}
          >
            <span className="logs-live-dot" />
            {live ? 'Live' : 'Paused'}
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={loadFull}>Refresh</button>
          <button type="button" className="btn-ghost btn-sm" onClick={handleDownload} disabled={!logs.length}>Download</button>
          <button type="button" className="btn-ghost btn-sm logs-clear-btn" onClick={handleClear}>Clear</button>
        </div>
      </header>

      <div className="logs-toolbar">
        <div className="logs-level-tabs">
          {LEVELS.map((l) => (
            <button
              key={l.key}
              className={`logs-level-tab${level === l.key ? ' is-active' : ''} logs-lvl-${l.key}`}
              onClick={() => setLevel(l.key)}
            >
              {l.label}
              {l.key !== 'all' && counts[l.key] ? <span className="logs-level-count">{counts[l.key]}</span> : null}
            </button>
          ))}
        </div>
        <div className="logs-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            placeholder="Search logs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && <button className="logs-search-clear" onClick={() => setSearch('')} aria-label="Clear search">×</button>}
        </div>
      </div>

      {error && <div className="logs-error">⚠ {error}</div>}

      <div className="logs-console" ref={viewportRef} onScroll={onScroll}>
        {loading && !logs.length ? (
          <div className="logs-empty">Loading logs…</div>
        ) : !logs.length ? (
          <div className="logs-empty">No log entries{search || level !== 'all' ? ' match the current filters' : ' yet'}.</div>
        ) : (
          logs.map((l) => (
            <div key={l.id} className={`logs-line logs-line-${l.level}`}>
              <span className="logs-line-time">{fmtTime(l.ts)}</span>
              <span className={`logs-line-badge logs-badge-${l.level}`}>{l.level}</span>
              <span className="logs-line-msg">{l.msg}</span>
            </div>
          ))
        )}
      </div>

      <div className="logs-statusbar">
        <span>{logs.length} line{logs.length === 1 ? '' : 's'} shown</span>
        <span className="logs-statusbar-sep">·</span>
        <span className="logs-stat logs-stat-info">{counts.info || 0} info</span>
        <span className="logs-stat logs-stat-warn">{counts.warn || 0} warn</span>
        <span className="logs-stat logs-stat-error">{counts.error || 0} error</span>
      </div>
    </div>
  );
}
