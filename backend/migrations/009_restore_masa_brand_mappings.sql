-- ============================================================
-- Restore Masa brand mappings (accidentally deleted by 008)
-- Run: psql $DATABASE_URL -f migrations/009_restore_masa_brand_mappings.sql
-- ============================================================

INSERT INTO brand_mappings (keyword, brand_code, description) VALUES
  ('ماسا', 'MSA', 'Masa Chat'),
  ('masa',  'MSA', 'Masa Chat (EN)')
ON CONFLICT (keyword) DO NOTHING;
