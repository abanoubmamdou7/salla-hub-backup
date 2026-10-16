-- Migration 005: add processed_orders array to poll_logs
ALTER TABLE poll_logs ADD COLUMN IF NOT EXISTS processed_orders JSONB DEFAULT '[]';
