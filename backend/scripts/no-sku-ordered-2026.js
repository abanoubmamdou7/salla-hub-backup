/**
 * Find products without SKU that were ordered in 2026.
 *
 * Because the Salla orders-list endpoint only returns item.name (no product_id),
 * we cross-reference by normalised product name.
 *
 * Steps:
 *  1. Paginate through all Salla orders; collect item names from 2026 orders.
 *  2. Fetch all products without SKU.
 *  3. Match by normalised name and print/save results.
 *
 * Usage:
 *   node scripts/no-sku-ordered-2026.js
 */

import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';
const TOKEN          = process.env.SALLA_ACCESS_TOKEN;

if (!TOKEN) {
  console.error('SALLA_ACCESS_TOKEN is not set in .env');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}` };

// ── helpers ───────────────────────────────────────────────────────────────────

function getOrderYear(order) {
  const raw = order?.date?.date ?? order?.created_at?.date ?? order?.created_at ?? null;
  if (!raw) return null;
  try {
    const d = new Date(String(raw).replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d.getFullYear();
  } catch {
    return null;
  }
}

/** Lowercase + collapse whitespace for fuzzy name comparison. */
function normalize(str) {
  return String(str ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// ── Step 1: collect item names from 2026 orders ───────────────────────────────

async function collect2026ItemNames() {
  const itemNames = new Set();   // normalised names
  let page = 1;
  let totalPages = 1;
  let ordersIn2026 = 0;

  console.log('Fetching orders…');

  do {
    const res = await axios.get(`${SALLA_API_BASE}/orders`, {
      headers,
      params: { page, per_page: 100 },
      timeout: 30000,
    });

    const body       = res.data;
    const orders     = body.data ?? [];
    const pagination = body.pagination ?? {};
    totalPages       = pagination.totalPages ?? pagination.last_page ?? 1;

    process.stdout.write(`\r  page ${page}/${totalPages}  `);

    let pageHad2026 = false;

    for (const order of orders) {
      if (getOrderYear(order) !== 2026) continue;
      ordersIn2026++;
      pageHad2026 = true;
      const items = order.items ?? order.products ?? [];
      for (const item of items) {
        if (item.name) itemNames.add(normalize(item.name));
      }
    }

    // Orders come newest-first; once a full page has no 2026 orders we can stop.
    if (!pageHad2026 && page > 1) {
      console.log('\n  No more 2026 orders — stopping early.');
      break;
    }

    page++;
  } while (page <= totalPages);

  console.log(`\n\nOrders in 2026          : ${ordersIn2026}`);
  console.log(`Unique item names (2026) : ${itemNames.size}`);

  return itemNames;
}

// ── Step 2: fetch all products without SKU ────────────────────────────────────

async function fetchAllNoSkuProducts() {
  const all = [];
  let page = 1;
  let totalPages = 1;

  console.log('\nFetching all products…');

  do {
    const res = await axios.get(`${SALLA_API_BASE}/products`, {
      headers,
      params: { page, per_page: 100 },
      timeout: 30000,
    });

    const body       = res.data;
    const products   = body.data ?? [];
    const pagination = body.pagination ?? {};
    totalPages       = pagination.totalPages ?? pagination.last_page ?? 1;

    process.stdout.write(`\r  page ${page}/${totalPages}  `);
    all.push(...products);
    page++;
  } while (page <= totalPages);

  const noSku = all.filter(p => !p.sku || String(p.sku).trim() === '');
  console.log(`\n\nTotal products : ${all.length}`);
  console.log(`No-SKU products: ${noSku.length}`);
  return noSku;
}

// ── Step 3: cross-reference & report ─────────────────────────────────────────

async function main() {
  const itemNames2026 = await collect2026ItemNames();
  const noSkuProducts = await fetchAllNoSkuProducts();

  // Match products whose normalised name appears in the set of 2026 order item names.
  const matched = noSkuProducts.filter(p => itemNames2026.has(normalize(p.name)));

  const divider = '─'.repeat(60);
  console.log(`\n${divider}`);
  console.log(`No-SKU products ordered in 2026: ${matched.length}`);
  console.log(divider);

  if (matched.length === 0) {
    console.log('None found.\n');
    console.log('Tip: The Salla API only returns item names (not IDs) in the orders list.');
    console.log('     Matching was done by exact normalised name.');
    return;
  }

  matched.forEach((p, i) => {
    const name   = p.name ?? '(no name)';
    const status = p.status ? `  status: ${p.status}` : '';
    const type   = p.type   ? `  type: ${p.type}`     : '';
    const price  = p.price?.amount != null ? `  price: ${p.price.amount} ${p.price.currency ?? ''}` : '';
    console.log(`${String(i + 1).padStart(3)}. [ID ${p.id}] ${name}${status}${type}${price}`);
  });

  const outPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../no-sku-ordered-2026.json'
  );
  await writeFile(outPath, JSON.stringify(matched, null, 2), 'utf8');
  console.log(`\nFull data saved → no-sku-ordered-2026.json`);
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
