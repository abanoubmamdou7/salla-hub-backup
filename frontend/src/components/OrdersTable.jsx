import { useState, useEffect } from 'react';
import { ordersList } from '../api/client';

const PER_PAGE = 50;

export default function OrdersTable({ statusFilter, tenantFilter, searchFilter, onViewOrder, refresh }) {
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Any filter change restarts from the first page.
  useEffect(() => {
    setPage(1);
  }, [statusFilter, tenantFilter, searchFilter, refresh]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = () =>
      ordersList({
        status:   statusFilter || undefined,
        tenantId: tenantFilter || undefined,
        search:   searchFilter || undefined,
        limit:    PER_PAGE,
        offset:   (page - 1) * PER_PAGE,
        summary:  true,
      })
        .then((data) => {
          if (cancelled) return;
          setOrders(data.orders || []);
          setTotal(data.total ?? (data.orders?.length || 0));
        })
        .catch((err) => { if (!cancelled) setError(err.message); })
        .finally(() => { if (!cancelled) setLoading(false); });
    // Debounce while typing in the search box so we don't query on every keystroke.
    const t = setTimeout(load, searchFilter ? 300 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [statusFilter, tenantFilter, searchFilter, refresh, page]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const from = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const to = Math.min(page * PER_PAGE, total);

  const pagination = totalPages > 1 && (
    <div className="orders-pagination">
      <span className="orders-pagination-info">
        Showing {from}–{to} of {total.toLocaleString()} orders
      </span>
      <div className="orders-pagination-btns">
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          ← Prev
        </button>
        <span className="orders-pagination-page">Page {page} / {totalPages}</span>
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          Next →
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="table-wrap table-loading-wrap">
        <div className="table-loading">
          <div className="spinner" aria-hidden />
          <p>Loading orders…</p>
        </div>
      </div>
    );
  }
  if (error) {
    return <div className="table-wrap"><div className="table-error-inline">Error: {error}</div></div>;
  }
  if (orders.length === 0) {
    return (
      <div className="table-wrap">
        <div className="table-empty">
          <p className="table-empty-title">No orders found</p>
          <p className="table-empty-desc">
            {searchFilter
              ? <>No orders match “{searchFilter}”.</>
              : 'Orders will appear here once synced from Salla.'}
          </p>
        </div>
        {pagination}
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="orders-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Client</th>
            <th>Customer</th>
            <th>Total</th>
            <th>Status</th>
            <th>Retries</th>
            <th>Last Error</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.salla_order_id || o.id}>
              <td>
                <button type="button" className="link-btn" onClick={() => onViewOrder(o.salla_order_id)}>
                  {o.order_number || o.salla_order_id}
                </button>
              </td>
              <td>
                {o.tenant_name
                  ? (
                    <span className="orders-client-chip">
                      <span className="orders-client-dot" />
                      {o.tenant_name}
                    </span>
                  )
                  : <span className="brands-empty-cell">—</span>
                }
              </td>
              <td>{o.customer_name || '—'}</td>
              <td>{o.total != null ? Number(o.total) : '—'}</td>
              <td>
                <span className={`badge badge-${o.edara_status || 'pending'}`}>
                  {o.edara_status || 'pending'}
                </span>
              </td>
              <td>{o.retry_count ?? 0}</td>
              <td className="cell-error" title={o.last_error || ''}>
                {o.last_error
                  ? `${String(o.last_error).slice(0, 40)}${o.last_error.length > 40 ? '…' : ''}`
                  : '—'}
              </td>
              <td className="brands-date-cell">
                {o.updated_at
                  ? new Date(o.updated_at).toLocaleString('en-GB', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pagination}
    </div>
  );
}
