-- Migration 004: add 'processing' to edara_status enum
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_edara_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_edara_status_check
  CHECK (edara_status IN ('pending', 'processing', 'sent', 'failed'));
