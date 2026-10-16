import { pool } from '../config/database.js';

function extractSallaOrderAt(sallaData) {
  const order = sallaData?.data ?? sallaData;
  const raw = order?.date?.date ?? order?.created_at?.date ?? order?.created_at ?? null;
  if (!raw) return null;
  try {
    const normalized = String(raw).replace(' ', 'T').replace(/(\.\d+)?$/, '+03:00');
    return new Date(normalized).toISOString();
  } catch { return null; }
}

export async function upsertOrder(sallaOrderId, sallaData, status = 'pending') {
  const sallaOrderAt = extractSallaOrderAt(sallaData);
  const { rows } = await pool.query(
    `INSERT INTO orders (salla_order_id, salla_data, edara_status, salla_order_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (salla_order_id) DO UPDATE
       SET salla_data     = EXCLUDED.salla_data,
           edara_status   = EXCLUDED.edara_status,
           salla_order_at = COALESCE(orders.salla_order_at, EXCLUDED.salla_order_at),
           updated_at     = NOW()
     RETURNING id, salla_order_id, edara_status AS status`,
    [sallaOrderId, JSON.stringify(sallaData), status, sallaOrderAt]
  );
  return rows[0];
}

export async function updateOrderStatus(sallaOrderId, status, { lastError = null, retryCount = null } = {}) {
  await pool.query(
    `UPDATE orders
     SET edara_status = $1,
         last_error   = COALESCE($2, last_error),
         retry_count  = COALESCE($3, retry_count),
         updated_at   = NOW()
     WHERE salla_order_id = $4`,
    [status, lastError, retryCount, sallaOrderId]
  );
}

export async function claimOrder(sallaOrderId) {
  const { rowCount } = await pool.query(
    `INSERT INTO order_locks (salla_order_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [sallaOrderId]
  );
  return rowCount > 0;
}

export async function releaseOrderClaim(sallaOrderId) {
  await pool.query(`DELETE FROM order_locks WHERE salla_order_id = $1`, [sallaOrderId]);
}

export async function getOrderByRef(orderRef) {
  const { rows } = await pool.query(
    `SELECT * FROM orders
     WHERE salla_order_id = $1
        OR salla_data->>'reference_id' = $1
        OR salla_data->'data'->>'reference_id' = $1
     LIMIT 1`,
    [String(orderRef)]
  );
  return rows[0] ?? null;
}

export async function getOrderBySallaId(sallaOrderId) {
  const { rows } = await pool.query(
    'SELECT * FROM orders WHERE salla_order_id = $1',
    [sallaOrderId]
  );
  return rows[0] ?? null;
}

// The visible order number can live in several places depending on how the row
// was ingested (webhook payload wraps the order in `data`, REST responses don't).
function buildOrderFilters({ status, search }) {
  const conditions = [];
  const params = [];

  if (status) { params.push(status); conditions.push(`o.edara_status = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    conditions.push(`(
      o.salla_order_id ILIKE ${p}
      OR o.salla_data->>'reference_id'          ILIKE ${p}
      OR o.salla_data->'data'->>'reference_id'  ILIKE ${p}
      OR o.salla_data->>'order_number'          ILIKE ${p}
      OR o.salla_data->'data'->>'order_number'  ILIKE ${p}
    )`);
  }

  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

export async function listOrders({ status = null, search = null, limit = 50, offset = 0, includeSummary = false } = {}) {
  const cols = includeSummary
    ? 'o.*'
    : 'o.id, o.salla_order_id, o.store_id, o.edara_status AS status, o.retry_count, o.last_error, o.created_at, o.updated_at';

  const { where, params } = buildOrderFilters({ status, search });
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT ${cols} FROM orders o
     ${where} ORDER BY o.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

export async function countOrders({ status = null, search = null } = {}) {
  const { where, params } = buildOrderFilters({ status, search });
  const { rows } = await pool.query(`SELECT COUNT(*) AS total FROM orders o ${where}`, params);
  return Number(rows[0].total);
}

export async function getFailedOrdersForRetry(maxRetries = 5) {
  const { rows } = await pool.query(
    `SELECT id, salla_order_id, salla_data, retry_count, last_error
     FROM orders
     WHERE edara_status = 'failed' AND retry_count < $1
     ORDER BY updated_at ASC`,
    [maxRetries]
  );
  return rows;
}

export async function reserveMasaSubmission(orderNumber, sallaOrderId) {
  const { rowCount } = await pool.query(
    `INSERT INTO masa_submissions (order_number, salla_order_id, status)
     VALUES ($1, $2, 'submitting')
     ON CONFLICT (order_number) DO NOTHING`,
    [String(orderNumber), String(sallaOrderId)]
  );
  return rowCount > 0;
}

export async function markMasaSubmissionResult(orderNumber, { status, providerRef = null, response = null }) {
  await pool.query(
    `UPDATE masa_submissions
     SET status = $1, provider_ref = COALESCE($2, provider_ref), response = $3
     WHERE order_number = $4`,
    [status, providerRef, response ? JSON.stringify(response) : null, String(orderNumber)]
  );
}

export async function getMasaSubmission(orderNumber) {
  const { rows } = await pool.query(
    `SELECT * FROM masa_submissions WHERE order_number = $1`,
    [String(orderNumber)]
  );
  return rows[0] ?? null;
}

/**
 * Persist a raw order webhook payload (with item options like the player ID) on arrival.
 * Only call this with payloads that actually carry items, so we never overwrite a good
 * order.created payload with a later option-less event (e.g. an invoice update).
 */
export async function saveWebhookPayload(sallaOrderId, payload, eventType = null) {
  await pool.query(
    `INSERT INTO webhook_order_payloads (salla_order_id, payload, event_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (salla_order_id) DO UPDATE
       SET payload     = EXCLUDED.payload,
           event_type  = EXCLUDED.event_type,
           received_at = NOW()`,
    [String(sallaOrderId), JSON.stringify(payload), eventType]
  );
}

/**
 * Read back a stored webhook payload for an order, or null if we never received one.
 * @returns {Promise<object|null>} the raw payload (top-level webhook body)
 */
export async function getWebhookPayload(sallaOrderId) {
  const { rows } = await pool.query(
    `SELECT payload FROM webhook_order_payloads WHERE salla_order_id = $1`,
    [String(sallaOrderId)]
  );
  return rows[0]?.payload ?? null;
}

export async function getLatestOrderId() {
  const { rows } = await pool.query(
    `SELECT salla_order_id FROM orders ORDER BY created_at DESC LIMIT 1`
  );
  return rows[0]?.salla_order_id ?? null;
}

export async function getStats() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)                                           AS total,
      COUNT(*) FILTER (WHERE edara_status = 'pending')  AS pending,
      COUNT(*) FILTER (WHERE edara_status = 'sent')     AS sent,
      COUNT(*) FILTER (WHERE edara_status = 'failed')   AS failed
    FROM orders
  `);
  const r = rows[0];
  return {
    total:   Number(r.total),
    pending: Number(r.pending),
    sent:    Number(r.sent),
    failed:  Number(r.failed),
  };
}
