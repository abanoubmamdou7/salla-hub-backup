import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

const pool = new Pool(poolConfig);

/**
 * Initialize database: ensure orders table and indexes exist.
 * Run this on app startup.
 */
/** Run a query and swallow errors (for ALTER TABLE / CREATE INDEX on tables we may not own). */
async function tryQuery(client, sql, label) {
  try {
    await client.query(sql);
  } catch (err) {
    console.warn(`[db] initDatabase — skipping "${label}": ${err.message}`);
  }
}

export async function initDatabase() {
  const client = await pool.connect();
  try {
    // ---- orders ------------------------------------------------
    await tryQuery(client, `
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        salla_order_id VARCHAR(255) UNIQUE NOT NULL,
        salla_data JSONB NOT NULL,
        edara_status VARCHAR(50) DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        event_type VARCHAR(100),
        store_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `, 'CREATE orders');
    await tryQuery(client, `ALTER TABLE orders ADD COLUMN IF NOT EXISTS event_type VARCHAR(100)`, 'ADD event_type');
    await tryQuery(client, `ALTER TABLE orders ADD COLUMN IF NOT EXISTS store_id  VARCHAR(255)`, 'ADD store_id');
    await tryQuery(client, `ALTER TABLE orders ADD COLUMN IF NOT EXISTS source     VARCHAR(50)  DEFAULT 'webhook'`, 'ADD source');
    await tryQuery(client, `ALTER TABLE orders ADD COLUMN IF NOT EXISTS masa_response  JSONB`,        'ADD masa_response');
    await tryQuery(client, `ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_ref  VARCHAR(255)`, 'ADD provider_ref');
    await tryQuery(client, `ALTER TABLE orders ADD COLUMN IF NOT EXISTS salla_order_at TIMESTAMPTZ`, 'ADD salla_order_at');
    await tryQuery(client, `ALTER TABLE orders ADD COLUMN IF NOT EXISTS masa_sent_at   TIMESTAMPTZ`, 'ADD masa_sent_at');
    await tryQuery(client, `CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(edara_status)`,                            'idx orders status');
    await tryQuery(client, `CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)`,                             'idx orders created_at');
    await tryQuery(client, `CREATE INDEX IF NOT EXISTS idx_orders_retry      ON orders(edara_status, retry_count) WHERE edara_status = 'failed'`, 'idx orders retry');

    // ---- poll_logs ---------------------------------------------
    await tryQuery(client, `
      CREATE TABLE IF NOT EXISTS poll_logs (
        id                SERIAL       PRIMARY KEY,
        started_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        finished_at       TIMESTAMPTZ,
        orders_found      INTEGER      NOT NULL DEFAULT 0,
        orders_processed  INTEGER      NOT NULL DEFAULT 0,
        orders_skipped    INTEGER      NOT NULL DEFAULT 0,
        status            VARCHAR(20)  NOT NULL DEFAULT 'running',
        error             TEXT,
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `, 'CREATE poll_logs');
    await tryQuery(client, `CREATE INDEX IF NOT EXISTS idx_poll_logs_started_at ON poll_logs(started_at DESC)`, 'idx poll_logs');

    // ---- order_locks (atomic claim — prevents double-submission) --
    await tryQuery(client, `
      CREATE TABLE IF NOT EXISTS order_locks (
        salla_order_id VARCHAR(255) PRIMARY KEY,
        claimed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `, 'CREATE order_locks');

    // ---- masa_submissions (bulletproof: one row per Masa orderNumber) --
    // PRIMARY KEY on order_number guarantees we can NEVER submit the same Masa
    // orderNumber twice, even across process restarts / race conditions.
    await tryQuery(client, `
      CREATE TABLE IF NOT EXISTS masa_submissions (
        order_number   VARCHAR(255) PRIMARY KEY,
        salla_order_id VARCHAR(255) NOT NULL,
        submitted_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        status         VARCHAR(20)  NOT NULL DEFAULT 'submitting',
        provider_ref   VARCHAR(255),
        response       JSONB
      )
    `, 'CREATE masa_submissions');
    await tryQuery(client, `CREATE INDEX IF NOT EXISTS idx_masa_submissions_salla ON masa_submissions(salla_order_id)`, 'idx masa_submissions');

    // ---- webhook_order_payloads (reliable source of item options / playerId) --
    // The REST API never returns item options, so we persist the raw webhook
    // payload on arrival and let the poller read the playerId from it.
    await tryQuery(client, `
      CREATE TABLE IF NOT EXISTS webhook_order_payloads (
        salla_order_id VARCHAR(255) PRIMARY KEY,
        payload        JSONB        NOT NULL,
        event_type     VARCHAR(100),
        received_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `, 'CREATE webhook_order_payloads');

    // ---- brand_mappings ----------------------------------------
    await tryQuery(client, `
      CREATE TABLE IF NOT EXISTS brand_mappings (
        id          SERIAL       PRIMARY KEY,
        keyword     VARCHAR(100) UNIQUE NOT NULL,
        brand_code  VARCHAR(50)  NOT NULL,
        description VARCHAR(255),
        created_at  TIMESTAMP    DEFAULT NOW(),
        updated_at  TIMESTAMP    DEFAULT NOW()
      )
    `, 'CREATE brand_mappings');
    await tryQuery(client, `CREATE INDEX IF NOT EXISTS idx_brand_mappings_keyword ON brand_mappings(keyword)`, 'idx brand_mappings');
    await tryQuery(client, `
      INSERT INTO brand_mappings (keyword, brand_code, description) VALUES
        ('ماسا',      'MSA', 'Masa Chat'),
        ('masa',      'MSA', 'Masa Chat (EN)'),
        ('سيلا شات', 'SLA', 'Seela Chat'),
        ('سيلا',      'SLA', 'Seela Chat (short)'),
        ('حبيبي',     'HBB', 'Habibi')
      ON CONFLICT (keyword) DO NOTHING
    `, 'seed brand_mappings');

    // ---- salla_tokens ------------------------------------------
    await tryQuery(client, `
      CREATE TABLE IF NOT EXISTS salla_tokens (
        id            SERIAL       PRIMARY KEY,
        store_id      VARCHAR(255) UNIQUE NOT NULL,
        access_token  TEXT         NOT NULL,
        refresh_token TEXT         NOT NULL,
        expires_in    INTEGER      NOT NULL,
        expires_at    TIMESTAMPTZ  NOT NULL,
        created_at    TIMESTAMPTZ  DEFAULT NOW() NOT NULL,
        updated_at    TIMESTAMPTZ  DEFAULT NOW() NOT NULL
      )
    `, 'CREATE salla_tokens');
    await tryQuery(client, `CREATE INDEX IF NOT EXISTS idx_salla_tokens_store_id ON salla_tokens(store_id)`, 'idx salla_tokens');
    await tryQuery(client, `
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$
    `, 'fn set_updated_at');
    await tryQuery(client, `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_salla_tokens_updated_at') THEN
          CREATE TRIGGER trg_salla_tokens_updated_at
            BEFORE UPDATE ON salla_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
      END $$
    `, 'trigger salla_tokens');

    console.log('[db] initDatabase complete');
  } finally {
    client.release();
  }
}

export { pool };
