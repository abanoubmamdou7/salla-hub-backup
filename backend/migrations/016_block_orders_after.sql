-- Per-client stale-order cutoff.
-- When set, the poller blocks (does not pull/send to Supplier Hub) any order
-- whose Salla creation time is older than this many minutes.
-- NULL = no cutoff (process every order regardless of age).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS block_orders_after_minutes INTEGER;
