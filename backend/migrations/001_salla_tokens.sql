-- ============================================================
-- Salla OAuth Tokens Table
-- Run: psql -d salla_orders -f migrations/001_salla_tokens.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS salla_tokens (
  id           SERIAL       PRIMARY KEY,
  store_id     VARCHAR(255) UNIQUE NOT NULL,

  -- OAuth credentials (store encrypted at rest if your DB supports it)
  access_token  TEXT        NOT NULL,
  refresh_token TEXT        NOT NULL,

  -- expires_in: lifetime in seconds returned by Salla (e.g. 3600)
  -- expires_at: absolute timestamp computed on insert/update
  expires_in   INTEGER      NOT NULL,
  expires_at   TIMESTAMPTZ  NOT NULL,

  created_at   TIMESTAMPTZ  DEFAULT NOW() NOT NULL,
  updated_at   TIMESTAMPTZ  DEFAULT NOW() NOT NULL
);

-- Fast lookup by store_id (already unique, but explicit index aids clarity)
CREATE INDEX IF NOT EXISTS idx_salla_tokens_store_id ON salla_tokens (store_id);

-- ---------------------------------------------------------------
-- Trigger: keep updated_at current on every UPDATE automatically
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_salla_tokens_updated_at ON salla_tokens;

CREATE TRIGGER trg_salla_tokens_updated_at
  BEFORE UPDATE ON salla_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
