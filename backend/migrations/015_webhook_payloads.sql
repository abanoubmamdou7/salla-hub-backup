-- Capture every incoming order webhook payload (which includes item options like
-- the player ID) keyed by Salla order ID. The REST API never returns item options,
-- so this is the reliable source the poller reads from instead of the flaky
-- /webhooks/logs API (which only returns the last 50 events).
CREATE TABLE IF NOT EXISTS webhook_order_payloads (
  salla_order_id VARCHAR(255) PRIMARY KEY,
  payload        JSONB        NOT NULL,
  event_type     VARCHAR(100),
  received_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
