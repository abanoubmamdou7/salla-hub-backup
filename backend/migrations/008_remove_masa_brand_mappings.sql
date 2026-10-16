-- ============================================================
-- Remove non-Masa brand mappings (سيلا، حبيبي)
-- Run: psql $DATABASE_URL -f migrations/008_remove_masa_brand_mappings.sql
-- ============================================================

DELETE FROM brand_mappings WHERE keyword IN ('سيلا شات', 'سيلا', 'حبيبي');
