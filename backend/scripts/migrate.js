#!/usr/bin/env node
/**
 * Run all pending SQL migrations from the /migrations folder.
 * Tracks applied migrations in a `schema_migrations` table so each file runs once only.
 *
 * Usage:
 *   node scripts/migrate.js
 *   npm run migrate
 */

import { readdir, readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../migrations');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied(client) {
  const { rows } = await client.query('SELECT filename FROM schema_migrations ORDER BY filename');
  return new Set(rows.map((r) => r.filename));
}

async function main() {
  const baseline = process.argv.includes('--baseline');

  // --rerun 003,004  → force re-run specific migrations by prefix
  const rerunArg  = process.argv.find((a) => a.startsWith('--rerun='));
  const rerunList = rerunArg ? rerunArg.replace('--rerun=', '').split(',').map((s) => s.trim()) : [];

  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // --rerun: delete matching entries from schema_migrations so they run again
    if (rerunList.length > 0) {
      for (const prefix of rerunList) {
        const match = files.find((f) => f.startsWith(prefix));
        if (!match) { console.warn(`  ⚠️  No file found for prefix "${prefix}"`); continue; }
        await client.query('DELETE FROM schema_migrations WHERE filename = $1', [match]);
        console.log(`  🔁 ${match} marked for re-run`);
      }
      // refresh applied set after deletions
      const refreshed = await getApplied(client);
      applied.clear?.();
      for (const f of refreshed) applied.add(f);
    }

    if (baseline) {
      // Mark all files as applied without running SQL (for pre-existing DBs)
      let marked = 0;
      for (const file of files) {
        if (applied.has(file)) {
          console.log(`  ✓ ${file} (already marked)`);
          continue;
        }
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
          [file]
        );
        console.log(`  📌 ${file} marked as applied (not run)`);
        marked++;
      }
      console.log(`\nBaseline done — ${marked} file(s) marked.`);
      return;
    }

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  ✓ ${file} (already applied)`);
        continue;
      }

      const sql = await readFile(resolve(MIGRATIONS_DIR, file), 'utf8');
      console.log(`  ▶ ${file} …`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ✅ ${file} applied`);
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ❌ ${file} FAILED: ${err.message}`);
        process.exit(1);
      }
    }

    if (ran === 0) {
      console.log('\nAll migrations already applied — nothing to do.');
    } else {
      console.log(`\nDone — ${ran} migration(s) applied.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration error:', err.message);
  process.exit(1);
});
