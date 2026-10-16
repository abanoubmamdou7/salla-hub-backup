import { fetchOrders, describeOptions, fetchOrderWithOptions } from './sallaApi.js';
import { upsertOrder, updateOrderStatus, getOrderBySallaId, claimOrder, releaseOrderClaim, reserveMasaSubmission, markMasaSubmissionResult } from '../models/order.js';
import { buildOrderBody, processOrder, sendOrderDraft, summarizeResponses, isOrderFulfillable, isOrderTooOld, orderAgeMinutes, staleCutoffMinutes } from './supplierHubService.js';
import { notifyNewOrder, notifyOrderSuccess, notifyOrderFailed, notifyOrderTimeline, notifyUnknownProduct } from './telegram.js';
import prisma from '../config/prisma.js';

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '10000', 10);

// Returns [{storeId, tenantCreds}] for all active tenants that have connected stores.
// THROWS on a DB failure (e.g. the database is unreachable / times out) so the caller
// can tell "the DB is down" apart from "there genuinely are no active stores". The old
// behaviour swallowed the error and returned [], which made an unreachable DB look
// identical to an empty config — the poller would silently pull zero orders forever.
async function getActiveStores() {
  const tokens = await prisma.sallaToken.findMany({
    where:   { client: { isActive: true } },
    include: { client: true },
  });

  return tokens.map((t) => ({
    storeId: t.storeId,
    tenantCreds: t.client ? {
      dbClientId:        t.client.id,
      hubApiKey:         t.client.hubApiKey,
      clientId:          t.client.masaClientId,
      supplierBaseUrl:   t.client.supplierBaseUrl,
      supplierApiKeyUrl: t.client.supplierApiKeyUrl,
      xEnvironment:      t.client.xEnvironment,
      playerIdField:     t.client.playerIdField,
      telegramBotToken:  t.client.telegramBotToken,
      telegramChatId:    t.client.telegramChatId,
      blockOrdersAfterMinutes: t.client.blockOrdersAfterMinutes,
    } : null,
  }));
}

function riyadhNow() {
  return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour12: false });
}

function parseSallaDate(order) {
  const raw = order?.date?.date ?? order?.created_at?.date ?? order?.created_at ?? null;
  if (!raw) return null;
  try {
    const s = String(raw).replace(' ', 'T');
    // If it already has a timezone (Z or +HH:MM) use as-is; otherwise assume Asia/Riyadh (+03:00)
    const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
    return new Date(hasTz ? s : `${s.replace(/\.\d+$/, '')}+03:00`);
  } catch { return null; }
}

function formatRiyadh(date) {
  if (!date) return '—';
  return date.toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour12: false });
}

let intervalId = null;
let isPolling  = false;

async function safeDb(fn, label) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[poller] DB error (${label}): ${err.message}`);
    return null;
  }
}

async function pollStoreOrders(storeId, tenantCreds) {
  // Fetch the most recent orders (newest first).
  //
  // NOTE: we deliberately do NOT use a single "latest order id" high-water mark.
  // Orders reach the DB from two paths — this poller AND the Salla webhook
  // (order.created → orderProcessor) — so they are not always discovered in Salla
  // order. A high-water mark + break/early-return permanently skips any older order
  // that is still un-ingested once a newer order lands in the DB first. Instead we
  // scan the whole page and check each order against the DB individually, so a
  // missed/failed webhook self-heals on the next poll.
  const { orders } = await fetchOrders({ storeId, page: 1, per_page: 25 });
  if (!orders?.length) return;

  // Decide what to process. An order needs attention if we haven't ingested it yet,
  // OR it's stuck in 'pending' — e.g. it was ingested by a non-order.created webhook
  // event, or it was "بإنتظار المراجعة" and has since been confirmed. Terminal states
  // (sent / skipped / blocked / failed) are left alone (failed has its own retry path).
  const toProcess = [];
  for (const order of orders) {
    const existing = await safeDb(() => getOrderBySallaId(String(order.id)), 'getOrderBySallaId');
    if (!existing) toProcess.push({ order, recover: false });
    else if (existing.edara_status === 'pending') toProcess.push({ order, recover: true });
  }
  if (!toProcess.length) return;

  console.log(`\n[poller] 🆕 ${toProcess.length} order(s) to process (store: ${storeId})`);

  // Process each order (newest first). claimOrder + reserveMasaSubmission below
  // guard against a webhook racing the poller for the same order.
  for (const { order, recover } of toProcess) {
    const orderId = String(order.id);
    const refId   = order.reference_id ?? orderId;

    // Stale-order cutoff: an order older than the configured window (default 5 min)
    // since creation is never auto-fulfilled — it's held 'blocked' for manual review.
    // Applies to recovery too: a late order isn't sent even if it was just confirmed.
    if (isOrderTooOld(order, tenantCreds)) {
      const age = orderAgeMinutes(order);
      console.log(`[poller] 🚫 Order ${orderId} blocked — age ${age?.toFixed(1)}min > ${staleCutoffMinutes(tenantCreds)}min cutoff (store: ${storeId})`);
      if (!recover) await safeDb(() => claimOrder(orderId), 'claimOrder(blocked)');
      await safeDb(() => upsertOrder(orderId, order, 'blocked'), 'upsertOrder(blocked)');
      continue;
    }

    // Never fulfil an order whose payment isn't confirmed (payment pending) or
    // that's cancelled/refunded. Keep it 'pending' and re-check next poll —
    // once Salla marks it confirmed we'll pick it up. Gated on the cheap list status,
    // before any claim or enrichment.
    if (!isOrderFulfillable(order)) {
      if (!recover) {
        await safeDb(() => claimOrder(orderId), 'claimOrder(awaiting)');
        await safeDb(() => upsertOrder(orderId, order, 'pending'), 'upsertOrder(awaiting)');
      }
      console.log(`[poller] ⏳ Order ${orderId} status "${order?.status?.slug ?? order?.status?.name ?? '?'}" not confirmed — keeping pending`);
      continue;
    }

    // New orders need an atomic claim to avoid racing the webhook. Recovery orders
    // are already claimed (they're in the DB as 'pending'); re-claiming would always
    // fail, so we skip it and rely on reserveMasaSubmission below as the send guard.
    if (!recover) {
      const claimed = await safeDb(() => claimOrder(orderId), 'claimOrder');
      if (!claimed) {
        console.log(`[poller] ⏭️  Order ${orderId} already claimed — skipping`);
        continue;
      }
    }

    let enrichedOrder;
    try {
      // Enrich in-process rather than over HTTP. The /orders/:id/live route sits
      // behind requireAuth, and the poller carries no session token — an HTTP call
      // 401s, the catch below swallows it, and the order proceeds on option-less
      // basic data, so the player ID is lost and every order fails with
      // "invalid user ID". Calling the function directly avoids the auth layer.
      enrichedOrder = await fetchOrderWithOptions(orderId, storeId, tenantCreds?.playerIdField);
    } catch (err) {
      console.warn(`[poller] ⚠️  Order enrichment failed for ${orderId} (${err.message}) — using basic data`);
      enrichedOrder = order;
    }

    // If the live endpoint returned no items (Salla REST API doesn't include them and
    // the webhook payload wasn't cached yet), fall back to the listing order's items so
    // buildOrderBody can resolve the product name and brand.
    if (!enrichedOrder?.items?.length && order?.items?.length) {
      enrichedOrder = { ...enrichedOrder, items: order.items };
    }

    const playerId   = enrichedOrder?.playerId ?? '(none)';
    const customer   = enrichedOrder?.customer?.full_name ?? order?.customer?.full_name ?? '—';
    const total      = enrichedOrder?.amounts?.total?.amount ?? order?.amounts?.total?.amount ?? '?';
    const currency   = enrichedOrder?.currency ?? order?.currency ?? 'SAR';
    const sallaDate  = parseSallaDate(enrichedOrder) ?? parseSallaDate(order);
    const detectedAt = new Date();
    const delaySec   = sallaDate ? Math.round((detectedAt - sallaDate) / 1000) : '?';

    // Authoritative stale-order gate. The cheap check above runs on the order
    // listing, which frequently arrives WITHOUT a parseable creation date — age
    // comes back null and the order silently slips through (this is exactly how a
    // 2.5h-old order got auto-sent). sallaDate is resolved from the enriched order,
    // which reliably carries the date, so re-check here before anything
    // irreversible (notify / reserve / send to supplier).
    const cutoffMin = staleCutoffMinutes(tenantCreds);
    const ageMin    = sallaDate ? (detectedAt - sallaDate) / 60000 : null;
    if (cutoffMin > 0 && ageMin != null && ageMin > cutoffMin) {
      console.log(`[poller] 🚫 Order ${orderId} blocked — age ${ageMin.toFixed(1)}min > ${cutoffMin}min cutoff (resolved post-enrichment) (store: ${storeId})`);
      await safeDb(() => upsertOrder(orderId, enrichedOrder, 'blocked'), 'upsertOrder(blocked-late)');
      continue;
    }

    try {
      await upsertOrder(orderId, enrichedOrder, 'pending');
    } catch (dbErr) {
      console.error(`[poller] ❌ DB save failed for ${orderId}: ${dbErr.message} — releasing claim and skipping`);
      await safeDb(() => releaseOrderClaim(orderId), 'releaseOrderClaim');
      continue;
    }

    const orderBody     = await buildOrderBody(enrichedOrder, tenantCreds);
    // An order can contain multiple items — bail if ANY of them is unknown.
    const items         = enrichedOrder?.items ?? order?.items ?? [];
    const unknownIdx    = (orderBody ?? []).findIndex((e) => e?.brandCode === 'UNKNOWN');

    // Diagnostic: surface the available option labels when the player ID is missing.
    if ((orderBody ?? []).some((e) => e?.playerId === '1')) {
      const optionsSeen = describeOptions(enrichedOrder);
      console.warn(`[poller] ⚠️  لم يُستخرج رقم اللاعب للأوردر ${orderId} — الحقل المُهيّأ: "${tenantCreds?.playerIdField || 'الأيدي'}" — الخيارات الموجودة: ${optionsSeen.length ? optionsSeen.join(' | ') : '(لا توجد خيارات في الـ payload)'}`);
    }

    if (unknownIdx !== -1) {
      const productName = items[unknownIdx]?.name ?? '';
      console.warn(`[poller] ⚠️  Unknown product for order ${orderId} — "${productName}" — skipping`);
      await safeDb(() => updateOrderStatus(orderId, 'skipped'), 'updateOrderStatus(skipped)');
      notifyUnknownProduct({ orderId, refId, productName }, tenantCreds);
      continue;
    }
    const sallaTime    = formatRiyadh(sallaDate);
    const detectedTime = riyadhNow();

    console.log('\n═══════════════════════════════════════════════');
    console.log(`📦  NEW ORDER DETECTED`);
    console.log('═══════════════════════════════════════════════');
    console.log(`   Order ID   : ${orderId}`);
    console.log(`   Reference  : ${refId}`);
    console.log(`   Customer   : ${customer}`);
    console.log(`   Total      : ${total} ${currency}`);
    console.log(`   Player ID  : ${playerId}`);
    console.log('───────────────────────────────────────────────');
    console.log(`   Created at : ${sallaTime} (Salla)`);
    console.log(`   Detected at: ${detectedTime} (Us)`);
    console.log(`   Delay      : ${delaySec} seconds`);
    console.log('───────────────────────────────────────────────');
    console.log(`   Order Body : ${JSON.stringify(orderBody)}`);
    console.log('═══════════════════════════════════════════════');

    notifyNewOrder({ orderId, refId, customer, total, currency, playerId, sallaTime, detectedTime, delaySec, orderBody }, tenantCreds);

    const coins       = orderBody?.[0]?.Coins ?? null;
    const orderNumber = orderBody?.[0]?.orderNumber ?? refId;

    const reserved = await safeDb(() => reserveMasaSubmission(orderNumber, orderId), 'reserveMasaSubmission');
    if (!reserved) {
      console.log(`[poller] ⏭️  Masa already submitted for orderNumber=${orderNumber} — skipping to prevent double-send`);
      await safeDb(() => updateOrderStatus(orderId, 'sent'), 'updateOrderStatus(sent-dedup)');
      continue;
    }

    const masaSentAt = new Date();
    try {
      const result = await processOrder(enrichedOrder, tenantCreds);
      const masaRepliedAt = new Date();
      const summary = summarizeResponses(result.orderResponse, result.orderBody ?? orderBody);
      if (summary.allSuccess) {
        const providerRef = summary.providerRefs.join(', ');
        const totalSec = sallaDate ? Math.round((Date.now() - sallaDate) / 1000) : '?';
        console.log(`\n✅ [DONE] Order ${orderId} → Masa SUCCESS at ${formatRiyadh(masaRepliedAt)} (${summary.succeeded.length} منتج, total ${totalSec}s from Salla)`);
        console.log(`   providerRef: ${providerRef}`);
        await safeDb(() => updateOrderStatus(orderId, 'sent'), 'updateOrderStatus(sent)');
        await safeDb(() => markMasaSubmissionResult(orderNumber, { status: 'success', providerRef, response: summary.items.map((it) => it.res) }), 'markMasaSubmissionResult(success)');
        notifyOrderSuccess({ orderId, refId, providerRef, totalSec }, tenantCreds);
        notifyOrderTimeline({ orderId, refId, customer, total, currency, playerId, coins, sallaCreatedAt: sallaDate, detectedAt, masaSentAt, masaRepliedAt, status: 'success', providerRef }, tenantCreds);
      } else {
        const errMsg = summary.errors.join(' | ');
        console.error(`\n❌ [FAIL] Order ${orderId} → Masa FAILED (${summary.failed.length}/${summary.items.length}): ${errMsg}`);
        await safeDb(() => updateOrderStatus(orderId, 'failed', { lastError: errMsg }), 'updateOrderStatus(failed)');
        await safeDb(() => markMasaSubmissionResult(orderNumber, { status: 'failed', response: summary.items.map((it) => it.res) }), 'markMasaSubmissionResult(failed)');
        // Draft only the products that failed — succeeded ones are already delivered.
        const failedEntries = summary.failed.map((it) => it.entry).filter(Boolean);
        let sentToHub = false;
        try { await sendOrderDraft(failedEntries.length ? failedEntries : orderBody, tenantCreds, errMsg); sentToHub = true; } catch (de) { console.error(`📋 [DRAFT] ❌ Failed: ${de.message}`); }
        const missingPlayerId = (result.orderBody ?? orderBody ?? []).some((e) => e?.playerId === '1');
        notifyOrderFailed({ orderId, refId, error: errMsg, sentToHub, missingPlayerId, optionsSeen: describeOptions(enrichedOrder) }, tenantCreds);
        notifyOrderTimeline({ orderId, refId, customer, total, currency, playerId, coins, sallaCreatedAt: sallaDate, detectedAt, masaSentAt, masaRepliedAt, status: 'failed', error: errMsg, draftSent: sentToHub }, tenantCreds);
      }
    } catch (err) {
      const masaRepliedAt = new Date();
      console.error(`\n❌ [FAIL] Order ${orderId} → Masa ERROR: ${err.message}`);
      await safeDb(() => updateOrderStatus(orderId, 'failed', { lastError: err.message }), 'updateOrderStatus(failed)');
      await safeDb(() => markMasaSubmissionResult(orderNumber, { status: 'failed', response: { error: err.message } }), 'markMasaSubmissionResult(error)');
      let sentToHub = false;
      try { await sendOrderDraft(orderBody, tenantCreds, err.message); sentToHub = true; } catch (de) { console.error(`📋 [DRAFT] ❌ Failed: ${de.message}`); }
      notifyOrderFailed({ orderId, refId, error: err.message, sentToHub }, tenantCreds);
      notifyOrderTimeline({ orderId, refId, customer, total, currency, playerId, coins, sallaCreatedAt: sallaDate, detectedAt, masaSentAt, masaRepliedAt, status: 'failed', error: err.message, draftSent: sentToHub }, tenantCreds);
    }
  }
}

async function pollOrders() {
  if (isPolling) return;
  isPolling = true;
  try {
    let stores;
    try {
      stores = await getActiveStores();
    } catch (err) {
      // DB unreachable / query timed out. This is the most common cause of
      // "orders aren't being pulled at all" — surface it loudly so it's obvious
      // in the logs, and let the next tick retry (transient blips self-heal).
      console.error(`[poller] ❌ Could not load active stores from DB — NO orders will be pulled this cycle: ${err.message}`);
      return;
    }

    if (!stores.length) {
      console.log('[poller] No active stores configured — skipping poll');
      return;
    }

    // Poll each store in isolation: one store's bad token / failed fetch must not
    // abort the loop and starve the other stores.
    for (const { storeId, tenantCreds } of stores) {
      try {
        await pollStoreOrders(storeId, tenantCreds);
      } catch (err) {
        console.error(`[poller] ❌ Store ${storeId} poll failed: ${err.message}`);
      }
    }
  } finally {
    isPolling = false;
  }
}

export function startOrderPoller() {
  if (intervalId) return;
  console.log(`[poller] ▶️  Started — checking every ${POLL_INTERVAL_MS / 1000}s`);
  pollOrders();
  intervalId = setInterval(pollOrders, POLL_INTERVAL_MS);
}

export function stopOrderPoller() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[poller] ⏹️  Stopped');
  }
}
