import dotenv from 'dotenv';
dotenv.config();

import { fetchOrders, fetchOrderWithOptions } from '../services/sallaApi.js';
import { upsertOrder, getOrderBySallaId } from '../models/order.js';
import { buildOrderBody } from '../services/supplierHubService.js';
import { initDatabase } from '../config/database.js';
import axios from 'axios';

const SERVER_BASE = `http://localhost:${process.env.PORT || 3002}`;

function ms(start) {
  return `${Date.now() - start}ms`;
}

async function run() {
  const t0 = Date.now();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  🧪 Test Poll Flow — fetch latest order → playerId → body');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Start: ${new Date().toLocaleString('ar-EG', { timeZone: 'Asia/Riyadh' })} (Riyadh)\n`);

  // ── DB init ──────────────────────────────────────────────────────
  try {
    await initDatabase();
    console.log(`✅ DB connected  (${ms(t0)})\n`);
  } catch (err) {
    console.warn(`⚠️  DB unavailable: ${err.message} — continuing without DB\n`);
  }

  // ── Step 1: Fetch latest order from Salla API ────────────────────
  console.log('── Step 1: Fetch latest order from Salla API ──────────────');
  const t1 = Date.now();
  const { orders } = await fetchOrders({ page: 1, per_page: 5 });

  if (!orders?.length) {
    console.error('❌ No orders returned from Salla API');
    process.exit(1);
  }

  const latestOrder = orders[0];
  const orderId = String(latestOrder.id);
  const refId = latestOrder.reference_id ?? orderId;
  const orderDate = latestOrder.date?.date ?? latestOrder.created_at ?? 'unknown';
  const status = latestOrder.status?.name ?? latestOrder.status?.slug ?? 'unknown';
  const customerName = latestOrder.customer?.full_name ?? '—';
  const total = latestOrder.amounts?.total?.amount ?? latestOrder.total?.amount ?? '?';
  const currency = latestOrder.currency ?? 'SAR';

  console.log(`   Order ID     : ${orderId}`);
  console.log(`   Reference    : ${refId}`);
  console.log(`   Date         : ${orderDate}`);
  console.log(`   Status       : ${status}`);
  console.log(`   Customer     : ${customerName}`);
  console.log(`   Total        : ${total} ${currency}`);
  console.log(`   ⏱️  Salla API took: ${ms(t1)}`);
  console.log();

  // ── Step 2: Save to DB ───────────────────────────────────────────
  console.log('── Step 2: Save to DB (upsert) ───────────────────────────');
  const t2 = Date.now();
  try {
    const existing = await getOrderBySallaId(orderId);
    if (existing) {
      console.log(`   ⏭️  Order ${orderId} already in DB (status: ${existing.edara_status})`);
    }
    const row = await upsertOrder(orderId, latestOrder, 'pending');
    console.log(`   ✅ Upserted — DB id: ${row.id}, status: ${row.edara_status}`);
  } catch (err) {
    console.warn(`   ⚠️  DB save failed: ${err.message}`);
  }
  console.log(`   ⏱️  DB took: ${ms(t2)}`);
  console.log();

  // ── Step 3: Call /orders/{id}/live to get playerId ───────────────
  console.log('── Step 3: Fetch enriched order (playerId) ────────────────');
  const t3 = Date.now();

  let enrichedOrder;
  try {
    const liveRes = await axios.get(`${SERVER_BASE}/orders/${orderId}/live`, { timeout: 30000 });
    enrichedOrder = liveRes.data?.data ?? liveRes.data;
    console.log(`   playerId     : ${enrichedOrder?.playerId ?? '(not found — will default to 1)'}`);
    console.log(`   Items count  : ${enrichedOrder?.items?.length ?? 0}`);
    if (enrichedOrder?.items?.length) {
      for (const item of enrichedOrder.items) {
        console.log(`     • ${item.name} (qty: ${item.quantity})`);
        if (item.options?.length) {
          for (const opt of item.options) {
            console.log(`       ↳ ${opt.name}: ${opt.value}`);
          }
        }
      }
    }
  } catch (err) {
    console.warn(`   ⚠️  Live endpoint failed: ${err.message}`);
    console.log('   Falling back to fetchOrderWithOptions directly...');
    try {
      enrichedOrder = await fetchOrderWithOptions(orderId);
      console.log(`   playerId     : ${enrichedOrder?.playerId ?? '(not found)'}`);
    } catch (err2) {
      console.warn(`   ⚠️  fetchOrderWithOptions also failed: ${err2.message}`);
      enrichedOrder = latestOrder;
    }
  }
  console.log(`   ⏱️  Live/enrich took: ${ms(t3)}`);
  console.log();

  // ── Step 4: Build Masa body (WITHOUT sending) ────────────────────
  console.log('── Step 4: Build Masa body (dry run — not sending) ────────');
  const t4 = Date.now();
  const masaBody = await buildOrderBody(enrichedOrder);
  console.log(`   ⏱️  Build took: ${ms(t4)}`);
  console.log();
  console.log('   📦 Ready-to-send body:');
  console.log('   ─────────────────────────────────────');
  console.log(JSON.stringify(masaBody, null, 4).split('\n').map(l => `   ${l}`).join('\n'));
  console.log('   ─────────────────────────────────────');
  console.log();

  // ── Summary ──────────────────────────────────────────────────────
  const totalTime = Date.now() - t0;
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  📊 Timing Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   Salla API (fetch orders)     : ${ms(t1)}`);
  console.log(`   DB upsert                    : ${ms(t2)}`);
  console.log(`   Live endpoint (playerId)     : ${ms(t3)}`);
  console.log(`   Build Masa body              : ${ms(t4)}`);
  console.log(`   ─────────────────────────────────`);
  console.log(`   TOTAL                        : ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log();

  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
