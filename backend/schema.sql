-- PostgreSQL schema for Salla Orders Hub
-- Run after creating the database: createdb salla_orders
-- Then: psql -d salla_orders -f schema.sql

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  salla_order_id VARCHAR(255) UNIQUE NOT NULL,
  salla_data JSONB NOT NULL,
  edara_status VARCHAR(50) CHECK (edara_status IN ('pending', 'sent', 'failed')) DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(edara_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_retry ON orders(edara_status, retry_count) WHERE edara_status = 'failed';
