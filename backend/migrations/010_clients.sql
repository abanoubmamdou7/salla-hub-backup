-- Extend the existing tenants table with credential fields needed for full multi-tenant support.
-- salla_tokens.tenant_id and orders.tenant_id already exist from earlier migrations.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS salla_webhook_secret  TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS edara_api_key         TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS edara_company         VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS edara_transaction_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS edara_profit_center   VARCHAR(100);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS edara_location        VARCHAR(100);
