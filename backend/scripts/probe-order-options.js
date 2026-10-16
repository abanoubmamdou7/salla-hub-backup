#!/usr/bin/env node
/**
 * Probe Salla API endpoints to find which one returns item OPTIONS (the player
 * ID custom field) for a given order. The order.created webhook payload arrives
 * stripped of options, so we must fetch them from the API — this finds the right
 * endpoint using the real store token.
 *
 * Usage:
 *   node scripts/probe-order-options.js <salla_order_id> [storeId]
 *   node scripts/probe-order-options.js 1388468958
 */

import axios from 'axios';
import prisma from '../config/prisma.js';
import { getValidSallaToken } from '../services/sallaTokenService.js';

const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';
const orderId = process.argv[2];
let storeId   = process.argv[3];

if (!orderId) {
  console.error('Usage: node scripts/probe-order-options.js <salla_order_id> [storeId]');
  process.exit(1);
}

// Auto-resolve the store if not provided (pick the first active token).
if (!storeId) {
  const tokens = await prisma.sallaToken.findMany({ where: { client: { isActive: true } } });
  if (!tokens.length) { console.error('No active stores found'); process.exit(1); }
  storeId = tokens[0].storeId;
  console.log(`Using store: ${storeId}`);
}

const token = await getValidSallaToken(storeId);
const headers = { Authorization: `Bearer ${token}` };

// Pull options from any item shape Salla might return.
function optionsOf(item) {
  return item?.options ?? item?.details ?? item?.fields ?? null;
}

function report(label, items) {
  if (!Array.isArray(items)) { console.log(`  ${label}: not an array →`, JSON.stringify(items)?.slice(0, 200)); return; }
  console.log(`  ${label}: ${items.length} item(s)`);
  items.forEach((it, i) => {
    const opts = optionsOf(it);
    console.log(`    item[${i}] name="${it?.name}" id=${it?.id} options=${opts ? JSON.stringify(opts) : '(none)'}`);
  });
}

const candidates = [
  { label: 'GET /orders/{id}',              url: `${SALLA_API_BASE}/orders/${orderId}`,        pick: (d) => d?.data?.items ?? d?.items },
  { label: 'GET /orders/items?order_id',     url: `${SALLA_API_BASE}/orders/items`,             params: { order_id: orderId }, pick: (d) => d?.data },
  { label: 'GET /orders/{id}/items',         url: `${SALLA_API_BASE}/orders/${orderId}/items`,  pick: (d) => d?.data },
];

for (const c of candidates) {
  console.log(`\n═══ ${c.label} ═══`);
  try {
    const res = await axios.get(c.url, { headers, params: c.params, timeout: 15000 });
    report('items', c.pick(res.data));
  } catch (err) {
    console.log(`  ❌ HTTP ${err.response?.status ?? '?'}: ${JSON.stringify(err.response?.data ?? err.message)?.slice(0, 200)}`);
  }
}

await prisma.$disconnect();
