-- ============================================================
-- Seed default brand mappings
-- Run: psql $DATABASE_URL -f migrations/007_seed_brand_mappings.sql
-- ============================================================

INSERT INTO brand_mappings (keyword, brand_code, description) VALUES
  ('ماسا',      'MSA', 'Masa Chat'),
  ('masa',      'MSA', 'Masa Chat (EN)')
ON CONFLICT (keyword) DO NOTHING;
