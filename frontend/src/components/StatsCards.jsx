import { useState, useEffect } from 'react';
import { ordersStats } from '../api/client';

const IconOrders = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
  </svg>
);
const IconPending = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
const IconStored = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconFailed = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
);

export default function StatsCards({ refresh }) {
  const [stats, setStats] = useState({ total: 0, pending: 0, sent: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    ordersStats()
      .then((data) => {
        if (!cancelled) {
          setStats({
            total: Number(data.total) || 0,
            pending: Number(data.pending) || 0,
            sent: Number(data.sent) || 0,
            failed: Number(data.failed) || 0,
          });
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);

  if (error) return <div className="stats-row stats-error">Error: {error}</div>;

  const cards = [
    { label: 'Total Orders', value: stats.total,   key: 'total',   accent: null,      icon: <IconOrders /> },
    { label: 'Pending',      value: stats.pending, key: 'pending', accent: 'warn',    icon: <IconPending /> },
    { label: 'Stored',       value: stats.sent,    key: 'sent',    accent: 'success', icon: <IconStored /> },
    { label: 'Failed',       value: stats.failed,  key: 'failed',  accent: 'danger',  icon: <IconFailed /> },
  ];

  return (
    <div className="stats-row">
      {cards.map(({ label, value, key, accent, icon }) => (
        <div key={key} className={`stat-card${accent ? ` stat-card-${accent}` : ''}`}>
          <div className="stat-card-top">
            <span className="stat-label">{label}</span>
            <span className="stat-icon">{icon}</span>
          </div>
          <span className="stat-value">
            {loading ? <span className="ov-stat-skeleton" /> : value}
          </span>
        </div>
      ))}
    </div>
  );
}
