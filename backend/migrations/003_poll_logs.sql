-- ============================================================
-- Migration 003: Poll Logs + Orders extra columns
-- Run: psql -d salla_orders -f migrations/003_poll_logs.sql
-- ============================================================

-- ── Add missing columns to orders ────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS event_type   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS store_id     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source       VARCHAR(50)  DEFAULT 'webhook',
  ADD COLUMN IF NOT EXISTS masa_response JSONB,
  ADD COLUMN IF NOT EXISTS provider_ref VARCHAR(255);

-- ── Poll Logs Table ───────────────────────────────────────────
-- One row per polling cycle. Tracks how many orders were found,
-- processed, skipped, and whether the cycle succeeded or errored.
CREATE TABLE IF NOT EXISTS poll_logs (
  id                SERIAL       PRIMARY KEY,
  started_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ,
  orders_found      INTEGER      NOT NULL DEFAULT 0,
  orders_processed  INTEGER      NOT NULL DEFAULT 0,
  orders_skipped    INTEGER      NOT NULL DEFAULT 0,
  status            VARCHAR(20)  NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running', 'ok', 'error')),
  error             TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_poll_logs_started_at ON poll_logs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_poll_logs_status     ON poll_logs (status);
