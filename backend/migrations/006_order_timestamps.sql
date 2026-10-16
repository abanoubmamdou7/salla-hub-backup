-- Migration 006: track salla order time and masa sent time
ALTER TABLE orders ADD COLUMN IF NOT EXISTS salla_order_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS masa_sent_at   TIMESTAMPTZ;
