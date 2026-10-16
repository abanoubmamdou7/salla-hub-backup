import { useState, useEffect } from 'react';
import { orderById } from '../api/client';

export default function OrderDetail({ orderId, onClose }) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(!!orderId);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!orderId) {
      setOrder(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    orderById(orderId)
      .then((data) => { if (!cancelled) setOrder(data); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderId]);

  if (!orderId) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Order {orderId}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {loading && <p>Loading…</p>}
        {error && <p className="detail-error">{error}</p>}
        {order && !loading && (
          <>
            <dl className="detail-dl">
              <dt>Salla Order ID</dt>
              <dd>{order.salla_order_id}</dd>
              <dt>Status</dt>
              <dd>
                <span className={`badge badge-${order.edara_status || 'pending'}`}>
                  {order.edara_status || 'pending'}
                </span>
              </dd>
              <dt>Retry count</dt>
              <dd>{order.retry_count ?? 0}</dd>
              <dt>Last error</dt>
              <dd className="detail-error-text">{order.last_error || '—'}</dd>
              <dt>Created</dt>
              <dd>{order.created_at ? new Date(order.created_at).toLocaleString() : '—'}</dd>
              <dt>Updated</dt>
              <dd>{order.updated_at ? new Date(order.updated_at).toLocaleString() : '—'}</dd>
            </dl>
            {order.salla_data && (
              <details className="detail-json">
                <summary>Salla data</summary>
                <pre>{JSON.stringify(order.salla_data, null, 2)}</pre>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
