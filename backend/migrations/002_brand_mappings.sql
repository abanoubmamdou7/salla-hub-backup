-- ============================================================
-- Brand Mappings Table
-- Run: psql -d salla_orders -f migrations/002_brand_mappings.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS brand_mappings (
  id          SERIAL       PRIMARY KEY,
  keyword     VARCHAR(255) UNIQUE NOT NULL,
  brand_code  VARCHAR(50)  NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ  DEFAULT NOW() NOT NULL,
  updated_at  TIMESTAMPTZ  DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brand_mappings_keyword ON brand_mappings (LOWER(keyword));

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

DROP TRIGGER IF EXISTS trg_brand_mappings_updated_at ON brand_mappings;

CREATE TRIGGER trg_brand_mappings_updated_at
  BEFORE UPDATE ON brand_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
