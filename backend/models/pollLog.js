import { pool } from '../config/database.js';

/**
 * Insert a new poll_log row with status='running' and return its id.
 * @returns {Promise<number>} log id
 */
export async function startPollLog() {
  const { rows } = await pool.query(
    `INSERT INTO poll_logs (started_at, status)
     VALUES (NOW(), 'running')
     RETURNING id`
  );
  return rows[0].id;
}

/**
 * Update an existing poll_log row when the cycle finishes.
 * @param {number} id
 * @param {{ ordersFound: number, ordersProcessed: number, ordersSkipped: number, error?: string }} stats
 */
export async function finishPollLog(id, { ordersFound = 0, ordersProcessed = 0, ordersSkipped = 0, error = null } = {}) {
  await pool.query(
    `UPDATE poll_logs
     SET finished_at      = NOW(),
         orders_found     = $1,
         orders_processed = $2,
         orders_skipped   = $3,
         status           = $4,
         error            = $5
     WHERE id = $6`,
    [ordersFound, ordersProcessed, ordersSkipped, error ? 'error' : 'ok', error ?? null, id]
  );
}

/**
 * Return the most recent poll log rows.
 * @param {number} [limit=50]
 */
export async function listPollLogs(limit = 50) {
  const { rows } = await pool.query(
    `SELECT id, started_at, finished_at, orders_found, orders_processed, orders_skipped, status, error
     FROM poll_logs
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}
