#!/usr/bin/env node
/**
 * Dump the full stored webhook payload for an order and hunt for anything that
 * looks like a player-ID field anywhere in the JSON (not just items[].options).
 *
 * Usage:
 *   node scripts/dump-payload.js <salla_order_id>
 *   node scripts/dump-payload.js 1388468958
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually so the script runs standalone.
try {
  const env = readFileSync(resolve(__dirname, '..', '.env'), 'utf8');
  env.split('\n').forEach((line) => {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
} catch { /* .env optional */ }

const orderId = process.argv[2];
if (!orderId) {
  console.error('Usage: node scripts/dump-payload.js <salla_order_id>');
  process.exit(1);
}

const pg = (await import('pg')).default;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

// Pull from both the raw webhook capture and the stored order data.
const wh = await pool.query('SELECT payload FROM webhook_order_payloads WHERE salla_order_id=$1', [String(orderId)]);
const ord = await pool.query('SELECT salla_data FROM orders WHERE salla_order_id=$1', [String(orderId)]);
await pool.end();

const payload = wh.rows[0]?.payload ?? ord.rows[0]?.salla_data ?? null;
if (!payload) {
  console.log(`No payload found for order ${orderId}`);
  process.exit(0);
}

console.log('═══════════════ FULL PAYLOAD ═══════════════');
console.log(JSON.stringify(payload, null, 2));

// Recursive scan: report every key whose name OR a nearby value hints at a player ID.
const NAME_HINT = /(ايدي|أيدي|لاعب|player|user.?id|\buid\b|\bid\b)/i;
const hits = [];
(function walk(node, path) {
  if (node == null) return;
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      const p = path ? `${path}.${k}` : k;
      // Salla option objects: { name: "...", value: "..." }
      if (k === 'name' && typeof v === 'string' && NAME_HINT.test(v)) {
        hits.push(`${path}: name="${v}" value=${JSON.stringify(node.value)}`);
      }
      if (NAME_HINT.test(k) && (typeof v === 'string' || typeof v === 'number')) {
        hits.push(`${p} = ${JSON.stringify(v)}`);
      }
      walk(v, p);
    }
  }
})(payload, '');

console.log('\n═══════════════ PLAYER-ID CANDIDATES ═══════════════');
console.log(hits.length ? [...new Set(hits)].join('\n') : '(none found anywhere in payload)');
