-- Supplier Hub credentials per client (replaces global env vars)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS supplier_client_id  VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS supplier_api_key    TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS supplier_environment VARCHAR(50) DEFAULT 'production';

-- Brand mapping: optional credentialMode sent in order body (e.g. 'CLIENT' for MSA)
ALTER TABLE brand_mappings ADD COLUMN IF NOT EXISTS credential_mode VARCHAR(50) DEFAULT NULL;

-- Telegram bot per client (replaces global env vars)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telegram_chat_id   VARCHAR(100);

-- Drop legacy Edara columns (no longer used)
ALTER TABLE tenants DROP COLUMN IF EXISTS edara_api_key;
ALTER TABLE tenants DROP COLUMN IF EXISTS edara_company;
ALTER TABLE tenants DROP COLUMN IF EXISTS edara_transaction_url;
ALTER TABLE tenants DROP COLUMN IF EXISTS edara_profit_center;
ALTER TABLE tenants DROP COLUMN IF EXISTS edara_location;
