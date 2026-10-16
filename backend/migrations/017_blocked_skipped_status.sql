-- Migration 017: allow 'blocked' and 'skipped' in edara_status.
-- The poller/orderProcessor set these statuses (stale-order cutoff → 'blocked',
-- unknown/non-Masa product → 'skipped'), but the CHECK constraint from migration
-- 004 only permitted ('pending','processing','sent','failed'). The missing values
-- made every upsertOrder(..., 'blocked') / updateOrderStatus(..., 'skipped') fail
-- the constraint; safeDb swallowed the error so a blocked order was never persisted
-- and the poller re-detected + re-blocked it every tick forever.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_edara_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_edara_status_check
  CHECK (edara_status IN ('pending', 'processing', 'sent', 'failed', 'blocked', 'skipped'));
