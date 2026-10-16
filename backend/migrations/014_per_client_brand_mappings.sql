-- Per-client brand mappings
-- client_id = NULL means the mapping is global (applies to all clients).
-- client_id = X   means the mapping only applies to that specific client.
-- Lookup order: client-specific first, then global fallback.

ALTER TABLE brand_mappings ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;

-- Drop the old global unique constraint on keyword alone
ALTER TABLE brand_mappings DROP CONSTRAINT IF EXISTS brand_mappings_keyword_key;

-- New composite unique: same keyword can exist once per client (and once globally)
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_mappings_keyword_client
  ON brand_mappings (keyword, client_id)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_mappings_keyword_global
  ON brand_mappings (keyword)
  WHERE client_id IS NULL;
