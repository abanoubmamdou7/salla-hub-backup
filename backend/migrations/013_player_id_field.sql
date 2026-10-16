-- Per-client custom field name used to extract the player ID from Salla order options.
-- Defaults to 'الأيدي' (the standard Arabic label used in Salla product options).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS player_id_field VARCHAR(255) DEFAULT 'الأيدي';
