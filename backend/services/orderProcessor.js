import { fetchOrder, fetchOrderWithOptions, fetchOrderItems, getOrderOption, describeOptions } from './sallaApi.js';
import { upsertOrder, updateOrderStatus, claimOrder, releaseOrderClaim } from '../models/order.js';
import { processOrder, buildOrderBody, sendOrderDraft, summarizeResponses, isOrderFulfillable, isOrderTooOld, orderAgeMinutes, staleCutoffMinutes } from './supplierHubService.js';
import { notifyOrderRetry, notifyNewOrder, notifyOrderSuccess, notifyOrderFailed, notifyOrderTimeline, notifyUnknownProduct } from './telegram.js';

function parseSallaDate(order) {
  const raw = order?.date?.date ?? order?.created_at?.date ?? order?.created_at ?? null;
  if (!raw) return null;
  try {
    const s = String(raw).replace(' ', 'T');
    const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
    return new Date(hasTz ? s : `${s.replace(/\.\d+$/, '')}+03:00`);
  } catch { return null; }
}

function riyadhNow() {
  return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour12: false });
}

function formatRiyadh(date) {
  if (!date) return '—';
  return date.toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour12: false });
}

// Wrap every DB call so a missing / unreachable database never crashes the main flow.
async function safeDb(fn, label) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[orderProcessor] DB unavailable (${label}): ${err.message} — continuing without DB`);
    return null;
  }
}

/**
 * Process a webhook event end-to-end:
 *   1. Fetch full order from Salla API (fallback to rawPayload if API fails)
 *   2. Persist to DB with status 'pending', then mark 'sent' when stored (skipped if DB unavailable)
 *
 * @param {string} sallaOrderId
 * @param {{ storeId?: string, eventType?: string, rawPayload?: object, customer_ip?: string }} [ctx]
 */
export async function processOrderFromWebhook(sallaOrderId, ctx = {}) {
  const { eventType = 'order.created', storeId, rawPayload, tenantCreds = null } = ctx;

  console.log('─────────────────────────────────────────');
  console.log(`📦 [ORDER] وصل أوردر جديد من سلة`);
  console.log(`   Order ID  : ${sallaOrderId}`);
  console.log(`   Event     : ${eventType}`);
  console.log(`   Store     : ${storeId ?? 'n/a'}`);
  console.log('─────────────────────────────────────────');

  let sallaData;
  try {
    sallaData = await fetchOrder(sallaOrderId, storeId);
    console.log(`✅ [SALLA] تم سحب بيانات الأوردر من سلة — ref: ${sallaData?.reference_id ?? sallaOrderId}`);
  } catch (err) {
    console.warn(`⚠️  [SALLA] فشل سحب الأوردر من API: ${err.message} — using webhook payload`);
    if (rawPayload) {
      sallaData = rawPayload;
    } else {
      await safeDb(
        () => upsertOrder(sallaOrderId, { error: err.message, fetched: false }, 'failed'),
        'upsertOrder(failed-fetch)'
      );
      console.error(`❌ [ORDER] لا توجد بيانات للأوردر ${sallaOrderId}`);
      return;
    }
  }

  // Options (e.g. playerId) are only present in the webhook payload, not the REST API response.
  const sourceWithOptions = rawPayload ?? sallaData;
  const rawOrderData = sourceWithOptions?.data ?? sourceWithOptions;
  const playerIdField = tenantCreds?.playerIdField || 'الأيدي';
  let playerId = getOrderOption(rawOrderData, playerIdField);

  // The order.created webhook arrives stripped of item options, so the player ID
  // is usually absent here. Fetch the items (with options) from Salla's API and
  // re-extract — this recovers it on the first attempt, no manual draft needed.
  if (!playerId) {
    try {
      const apiItems = await fetchOrderItems(sallaOrderId, storeId);
      if (apiItems?.length) {
        rawOrderData.items = apiItems;
        playerId = getOrderOption(rawOrderData, playerIdField);
        if (playerId) console.log(`   Player ID : ${playerId} (مُسترجع من Order Items API)`);
      }
    } catch (e) {
      console.warn(`[orderProcessor] items API enrich failed for ${sallaOrderId}: ${e.message}`);
    }
  }

  const optionsSeen = describeOptions(rawOrderData);

  console.log(`   Player ID : ${playerId ?? '(غير موجود — سيستخدم الافتراضي)'}`);
  if (!playerId) {
    console.warn(`⚠️  [ORDER] لم يُستخرج رقم اللاعب للأوردر ${sallaOrderId} — الحقل المُهيّأ: "${playerIdField}" — الخيارات الموجودة: ${optionsSeen.length ? optionsSeen.join(' | ') : '(لا توجد خيارات في الـ payload)'}`);
  }

  if (playerId) sallaData = { ...sallaData, playerId };

  // Prefer rawPayload.data — webhook payload has items + options, REST API does not
  const dataToStore = rawPayload?.data ?? sallaData;
  await safeDb(
    () => upsertOrder(sallaOrderId, dataToStore, 'pending'),
    'upsertOrder(pending)'
  );

  // Stale-order cutoff: an order older than the configured window (default 5 min) since
  // creation must NOT be auto-fulfilled — it's held 'blocked' for manual review.
  const tooOld = isOrderTooOld(dataToStore, tenantCreds);

  // Auto-submit to supplier hub on a freshly-created order — but only once its
  // payment is confirmed. Orders still "بإنتظار الدفع" (or cancelled/refunded)
  // must NOT be fulfilled here; they stay 'pending' and the poller picks them up
  // once Salla marks them confirmed. "بإنتظار المراجعة" orders ARE sent.
  const shouldFulfill = !tooOld && eventType === 'order.created' && isOrderFulfillable(dataToStore);

  if (tooOld && eventType === 'order.created') {
    const age = orderAgeMinutes(dataToStore);
    console.log(`[ORDER] 🚫 الأوردر ${sallaOrderId} عُمره ${age?.toFixed(1)} دقيقة — تجاوز حد الـ ${staleCutoffMinutes(tenantCreds)} دقائق، لن يُنفّذ`);
    await safeDb(() => updateOrderStatus(sallaOrderId, 'blocked'), 'updateOrderStatus(blocked-stale)');
  } else if (!shouldFulfill && eventType === 'order.created') {
    console.log(`[ORDER] ⏳ الأوردر ${sallaOrderId} حالته "${dataToStore?.status?.slug ?? dataToStore?.status?.name ?? '?'}" — لسه غير مؤكد، لن يُرسل للـ Supplier Hub (سيتكفّل به الـ poller لاحقاً)`);
  } else if (shouldFulfill) {
    // Atomic claim — skip if poller already picked it up
    const claimed = await safeDb(() => claimOrder(sallaOrderId), 'claimOrder');
    if (!claimed) {
      console.log(`⏭️  [ORDER] الأوردر ${sallaOrderId} محجوز بالفعل — تم التخطي`);
      return;
    }

    console.log(`🚀 [MASA] جاري إرسال الأوردر للـ Supplier Hub...`);
    const orderForSupplier = { ...(dataToStore ?? sallaData), playerId };

    // Extract order details for notifications (shared across all paths below)
    const order    = orderForSupplier?.data ?? orderForSupplier;
    const refId    = order?.reference_id ?? sallaOrderId;
    const customer = order?.customer?.first_name
      ? `${order.customer.first_name} ${order.customer.last_name ?? ''}`.trim()
      : (order?.customer?.full_name ?? order?.customer?.name ?? '—');
    const total    = order?.amounts?.total?.amount ?? order?.total ?? '?';
    const currency = order?.currency ?? 'SAR';
    const sallaCreatedAt = parseSallaDate(order);
    const detectedAt     = new Date();

    async function sendDraft(orderBody, label, reason) {
      try {
        await sendOrderDraft(orderBody, undefined, reason);
        console.log(`📋 [DRAFT] ✅ Draft sent — ${label}`);
      } catch (de) {
        console.error(`📋 [DRAFT] ❌ Failed — ${label}: ${de.message}`);
      }
    }

    function buildRetryNotifyPayload(errMsg, coins = null) {
      return { orderId: sallaOrderId, refId, customer, total, currency, coins, error: errMsg, optionsSeen };
    }

    async function retryOnce(orderBody) {
      const enriched       = await fetchOrderWithOptions(sallaOrderId, storeId);
      const retrySentAt    = new Date();
      const retryResult    = await processOrder(enriched);
      const retryRepliedAt = new Date();
      const retryBody      = retryResult.orderBody ?? orderBody;
      const summary        = summarizeResponses(retryResult.orderResponse, retryBody);
      const retryCoins     = retryBody?.[0]?.Coins ?? null;

      if (summary.allSuccess) {
        const providerRef = summary.providerRefs.join(', ');
        console.log('─────────────────────────────────────────');
        console.log(`✅ [RETRY] تم تنفيذ الأوردر بنجاح بعد الإعادة`);
        console.log(`   Order      : ${sallaOrderId}`);
        console.log(`   providerRef: ${providerRef}`);
        console.log('─────────────────────────────────────────');
        await safeDb(() => updateOrderStatus(sallaOrderId, 'sent'), 'updateOrderStatus(sent-retry)');
        const totalSec = sallaCreatedAt ? Math.round((Date.now() - sallaCreatedAt) / 1000) : '?';
        notifyOrderSuccess({ orderId: sallaOrderId, refId, providerRef, totalSec }, tenantCreds);
        notifyOrderTimeline({
          orderId: sallaOrderId, refId, customer, total, currency, playerId, coins: retryCoins,
          sallaCreatedAt, detectedAt, masaSentAt: retrySentAt, masaRepliedAt: retryRepliedAt,
          status: 'success', providerRef,
        }, tenantCreds);
        return true;
      }

      const retryErrMsg = summary.errors.join(' | ');
      console.error(`❌ [RETRY] فشلت الإعادة أيضاً — ${retryErrMsg}`);
      await safeDb(() => updateOrderStatus(sallaOrderId, 'failed', { lastError: retryErrMsg }), 'updateOrderStatus(failed-retry)');
      // Draft only the products that failed — the ones that succeeded are already delivered.
      const failedEntries = summary.failed.map((it) => it.entry).filter(Boolean);
      let retrySentToHub = false;
      try { await sendOrderDraft(failedEntries.length ? failedEntries : retryBody, undefined, retryErrMsg); retrySentToHub = true; } catch {}
      // Still no player ID after re-fetch → flag it clearly with the fields we did receive.
      const stillMissingId = (retryBody ?? []).some((e) => e?.playerId === '1');
      notifyOrderFailed({
        orderId: sallaOrderId, refId, error: retryErrMsg, sentToHub: retrySentToHub,
        missingPlayerId: stillMissingId, optionsSeen: describeOptions(enriched),
      }, tenantCreds);
      notifyOrderTimeline({
        orderId: sallaOrderId, refId, customer, total, currency, playerId, coins: retryCoins,
        sallaCreatedAt, detectedAt, masaSentAt: retrySentAt, masaRepliedAt: retryRepliedAt,
        status: 'failed', error: retryErrMsg, draftSent: retrySentToHub,
      }, tenantCreds);
      return false;
    }

    // Build orderBody early so notifyNewOrder can include it
    let orderBodyEarly = null;
    try { orderBodyEarly = await buildOrderBody(orderForSupplier, tenantCreds); } catch {}
    const entries = orderBodyEarly ?? [];
    const coins = entries[0]?.Coins ?? null;

    // Filter: only process Masa orders (brandCode MSA or fallback Arabic ماسا).
    // An order can contain multiple items — bail if ANY of them is unknown/non-Masa.
    const items = order?.items ?? [];
    const unknownIdx = entries.findIndex((e) => e?.brandCode === 'UNKNOWN');
    if (unknownIdx !== -1) {
      const productName = items[unknownIdx]?.name ?? '';
      console.warn(`[ORDER] ⚠️  Unknown product for order ${sallaOrderId} — "${productName}" — skipping`);
      await safeDb(() => updateOrderStatus(sallaOrderId, 'skipped'), 'updateOrderStatus(skipped)');
      await safeDb(() => releaseOrderClaim(sallaOrderId), 'releaseOrderClaim(unknown-brand)');
      notifyUnknownProduct({ orderId: sallaOrderId, refId, productName }, tenantCreds);
      return;
    }
    const isMasa = (b) => !b || b === 'MSA' || b.includes('ماسا');
    const nonMasa = entries.find((e) => !isMasa(e?.brandCode));
    if (nonMasa) {
      console.log(`[ORDER] ⏭️  Skipping non-Masa order ${sallaOrderId} — brandCode: ${nonMasa.brandCode}`);
      await safeDb(() => updateOrderStatus(sallaOrderId, 'skipped'), 'updateOrderStatus(skipped)');
      await safeDb(() => releaseOrderClaim(sallaOrderId), 'releaseOrderClaim(non-masa)');
      return;
    }

    notifyNewOrder({
      orderId:      sallaOrderId,
      refId,
      customer,
      total,
      currency,
      playerId,
      sallaTime:    formatRiyadh(sallaCreatedAt),
      detectedTime: riyadhNow(),
      delaySec:     sallaCreatedAt ? Math.round((detectedAt - sallaCreatedAt) / 1000) : '?',
      orderBody:     orderBodyEarly,
    }, tenantCreds);

    const masaSentAt = new Date();
    processOrder(orderForSupplier).then(async (result) => {
      const masaRepliedAt = new Date();
      const orderBody  = result.orderBody ?? orderBodyEarly;
      const summary    = summarizeResponses(result.orderResponse, orderBody);
      const brandCode = orderBody?.[0]?.brandCode;

      if (summary.allSuccess) {
        const providerRef = summary.providerRefs.join(', ');
        console.log('─────────────────────────────────────────');
        console.log(`✅ [MASA] تم تنفيذ الأوردر بنجاح (${summary.succeeded.length} منتج)`);
        console.log(`   Order      : ${sallaOrderId}`);
        console.log(`   providerRef: ${providerRef}`);
        console.log('─────────────────────────────────────────');
        await safeDb(() => updateOrderStatus(sallaOrderId, 'sent'), 'updateOrderStatus(sent)');
        const totalSec = sallaCreatedAt ? Math.round((Date.now() - sallaCreatedAt) / 1000) : '?';
        notifyOrderSuccess({ orderId: sallaOrderId, refId, providerRef, totalSec }, tenantCreds);
        notifyOrderTimeline({
          orderId: sallaOrderId, refId, customer, total, currency, playerId, coins,
          sallaCreatedAt, detectedAt, masaSentAt, masaRepliedAt,
          status: 'success', providerRef,
        }, tenantCreds);
        return;
      }

      const errMsg = summary.errors.join(' | ');
      console.error('─────────────────────────────────────────');
      console.error(`❌ [MASA] فشل تنفيذ الأوردر ${sallaOrderId} (${summary.failed.length}/${summary.items.length} منتج)`);
      console.error(`   errors : ${errMsg}`);
      console.error('─────────────────────────────────────────');
      await safeDb(() => updateOrderStatus(sallaOrderId, 'failed', { lastError: errMsg }), 'updateOrderStatus(failed)');

      // Retry only when NOTHING succeeded (no-playerId fails every item) — never
      // re-run when some products already delivered, or they'd double-deliver.
      if (summary.succeeded.length === 0 && !playerId && brandCode === 'MSA') {
        console.log(`🔄 [RETRY] MSA + no Player ID — retrying in 5s...`);
        await notifyOrderRetry(buildRetryNotifyPayload(errMsg, orderBody?.[0]?.Coins), tenantCreds);
        await new Promise(r => setTimeout(r, 5000));
        try {
          await retryOnce(orderBody);
        } catch (retryErr) {
          console.error(`❌ [RETRY] استثناء أثناء الإعادة: ${retryErr.message}`);
          await sendDraft(orderBody, sallaOrderId, errMsg);
        }
        return;
      }

      // Draft only the products that failed — succeeded ones are already delivered.
      const failedEntries = summary.failed.map((it) => it.entry).filter(Boolean);
      let sentToHub = false;
      try { await sendOrderDraft(failedEntries.length ? failedEntries : orderBody, undefined, errMsg); sentToHub = true; console.log(`📋 [DRAFT] ✅ Draft sent for ${refId}`); } catch (de) { console.error(`📋 [DRAFT] ❌ Failed — ${refId}: ${de.message}`); }
      notifyOrderFailed({ orderId: sallaOrderId, refId, error: errMsg, sentToHub }, tenantCreds);
      notifyOrderTimeline({
        orderId: sallaOrderId, refId, customer, total, currency, playerId, coins,
        sallaCreatedAt, detectedAt, masaSentAt, masaRepliedAt,
        status: 'failed', error: errMsg, draftSent: sentToHub,
      }, tenantCreds);

    }).catch(async (err) => {
      const masaRepliedAt = new Date();
      console.error('─────────────────────────────────────────');
      console.error(`❌ [MASA] فشل إرسال الأوردر ${sallaOrderId}: ${err.message}`);
      console.error('─────────────────────────────────────────');
      await safeDb(() => updateOrderStatus(sallaOrderId, 'failed', { lastError: err.message }), 'updateOrderStatus(failed)');

      let orderBody  = orderBodyEarly;
      let brandCode = orderBody?.[0]?.brandCode ?? null;
      if (!orderBody) {
        try {
          orderBody  = await buildOrderBody(orderForSupplier, tenantCreds);
          brandCode = orderBody?.[0]?.brandCode;
        } catch {}
      }

      if (!playerId && brandCode === 'MSA') {
        console.log(`🔄 [RETRY] MSA + no Player ID — retrying in 5s...`);
        await notifyOrderRetry(buildRetryNotifyPayload(err.message, orderBody?.[0]?.Coins));
        await new Promise(r => setTimeout(r, 5000));
        try {
          await retryOnce(orderBody);
        } catch (retryErr) {
          console.error(`❌ [RETRY] استثناء أثناء الإعادة: ${retryErr.message}`);
          if (orderBody) await sendDraft(orderBody, sallaOrderId, err.message);
        }
        return;
      }

      // All other failures → draft immediately
      let sentToHub = false;
      if (orderBody) {
        try { await sendOrderDraft(orderBody, undefined, err.message); sentToHub = true; console.log(`📋 [DRAFT] ✅ Draft sent for ${refId}`); } catch (de) { console.error(`📋 [DRAFT] ❌ Failed — ${refId}: ${de.message}`); }
      }
      notifyOrderFailed({ orderId: sallaOrderId, refId, error: err.message, sentToHub }, tenantCreds);
      notifyOrderTimeline({
        orderId: sallaOrderId, refId, customer, total, currency, playerId, coins,
        sallaCreatedAt, detectedAt, masaSentAt, masaRepliedAt,
        status: 'failed', error: err.message, draftSent: sentToHub,
      }, tenantCreds);
    });
  }
}
