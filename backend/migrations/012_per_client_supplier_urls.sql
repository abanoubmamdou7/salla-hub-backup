-- Per-client supplier endpoint overrides
-- These columns let each client point to a different supplier base URL
-- and API key generation URL, overriding the global env vars.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS supplier_base_url    TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS supplier_api_key_url TEXT;
