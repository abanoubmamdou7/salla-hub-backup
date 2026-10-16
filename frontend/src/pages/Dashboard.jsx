import { useState, useCallback, useEffect } from 'react';
import StatsCards  from '../components/StatsCards';
import OrdersTable from '../components/OrdersTable';
import OrderDetail from '../components/OrderDetail';
import { ordersStats, getApiBase, clientsList } from '../api/client';

export default function Dashboard() {
  const [statusFilter,   setStatusFilter]   = useState('');
  const [tenantFilter,   setTenantFilter]   = useState('');
  const [searchFilter,   setSearchFilter]   = useState('');
  const [clients,        setClients]        = useState([]);
  const [detailOrderId,  setDetailOrderId]  = useState(null);
  const [refreshKey,     setRefreshKey]     = useState(0);
  const [connectionError, setConnectionError] = useState(null);
  const [checkingConnection, setCheckingConnection] = useState(true);

  const checkConnection = useCallback(async () => {
    setCheckingConnection(true);
    setConnectionError(null);
    try {
      const [, clientsRes] = await Promise.allSettled([ordersStats(), clientsList()]);
      if (clientsRes.status === 'fulfilled') setClients(clientsRes.value.data ?? []);
    } catch (err) {
      setConnectionError(err.message || 'Could not reach the API');
    } finally {
      setCheckingConnection(false);
    }
  }, []);

  // Re-check connection properly
  useEffect(() => {
    setCheckingConnection(true);
    setConnectionError(null);
    ordersStats()
      .then(() => clientsList().then(d => setClients(d.data ?? [])).catch(() => {}))
      .catch(err => setConnectionError(err.message || 'Could not reach the API'))
      .finally(() => setCheckingConnection(false));
  }, []);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  if (checkingConnection) {
    return (
      <div className="dashboard">
        <header className="ov-header"><div><h1>Orders</h1></div></header>
        <div className="dashboard-loading"><div className="spinner" aria-hidden /><p>Connecting…</p></div>
      </div>
    );
  }

  if (connectionError) {
    return (
      <div className="dashboard">
        <header className="ov-header"><div><h1>Orders</h1></div></header>
        <div className="connection-error-card">
          <div className="connection-error-icon" aria-hidden>!</div>
          <h2>Can&apos;t connect to the API</h2>
          <p className="connection-error-message">{connectionError}</p>
          <p className="connection-error-url">API: <code>{getApiBase()}</code></p>
          <p className="connection-error-hint">
            Make sure the backend is running and <code>CORS_ORIGIN</code> includes this site&apos;s URL.
          </p>
          <button type="button" className="btn-primary" onClick={checkConnection}>Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="ov-header">
        <div>
          <h1>Orders</h1>
          <p>All orders received from connected Salla stores</p>
        </div>
        <button className="btn-ghost btn-sm" onClick={refresh}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{marginRight:5}}>
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
          </svg>
          Refresh
        </button>
      </header>

      <div className="dashboard-controls">
        {/* Status filter */}
        <label>
          <span className="control-label">Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="select-status">
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </label>

        {/* Client filter */}
        {clients.length > 0 && (
          <label>
            <span className="control-label">Client</span>
            <select value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)} className="select-status">
              <option value="">All clients</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}

        {/* Order search */}
        <div className="logs-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            placeholder="Search by order number…"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
          {searchFilter && (
            <button className="logs-search-clear" onClick={() => setSearchFilter('')} aria-label="Clear search">×</button>
          )}
        </div>
      </div>

      <StatsCards refresh={refreshKey} />
      <OrdersTable
        statusFilter={statusFilter}
        tenantFilter={tenantFilter}
        searchFilter={searchFilter}
        onViewOrder={setDetailOrderId}
        refresh={refreshKey}
      />
      <OrderDetail orderId={detailOrderId} onClose={() => setDetailOrderId(null)} />
    </div>
  );
}
