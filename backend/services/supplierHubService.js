import axios from 'axios';
import { resolveBrand } from '../models/brandMapping.js';
import { extractOptionValue } from './sallaApi.js';

function apiError(step, err) {
  const status = err.response?.status;
  const body   = JSON.stringify(err.response?.data ?? err.response?.statusText ?? err.message);
  const msg    = `[hub] ❌ ${step} failed — HTTP ${status ?? 'N/A'}: ${body}`;
  console.error(msg);
  throw new Error(msg);
}

/**
 * Resolve credentials — only hubApiKey is per-client (from tenantCreds).
 * Everything else is global, sourced from env vars.
 */
function resolveCreds(tenantCreds) {
  return {
    dbClientId:        tenantCreds?.dbClientId        ?? null,
    hubApiKey:         tenantCreds?.hubApiKey         || '',
    clientId:          tenantCreds?.clientId          || '',
    supplierBaseUrl:   tenantCreds?.supplierBaseUrl   || process.env.SUPPLIER_BASE_URL    || '',
    supplierApiKeyUrl: tenantCreds?.supplierApiKeyUrl || process.env.SUPPLIER_API_KEY_URL || '',
    xEnvironment:      tenantCreds?.xEnvironment      || process.env['X-environment']     || 'production',
    playerIdField:     tenantCreds?.playerIdField     || 'الأيدي',
  };
}

// ─── Step 1: Generate API Key ─────────────────────────────────────────────────
async function generateApiKey(creds) {
  console.log('[hub] Step 1 — generating API key, client_id:', creds.clientId);
  try {
    const res = await axios.post(creds.supplierApiKeyUrl, { client_id: creds.clientId });
    return res.data.api_key;
  } catch (err) { apiError('generateApiKey', err); }
}

// ─── Step 2: Get Access Token ─────────────────────────────────────────────────
async function getAccessToken(apiKey, creds) {
  console.log('[hub] Step 2 — getting access token');
  try {
    const res = await axios.post(`${creds.supplierBaseUrl}/auth/validate`, {
      client_id: creds.clientId,
      api_key:   apiKey,
    });
    return res.data.access_token;
  } catch (err) { apiError('getAccessToken', err); }
}

// ─── Auth with retry (handles key rotation race condition) ────────────────────
// The Supabase key rotates every 30 min; a brief sync delay can cause key_not_found.
// Retrying once after 2s re-fetches a fresh key and resolves it.
async function getAuthToken(creds, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const apiKey = await generateApiKey(creds);
      const token  = await getAccessToken(apiKey, creds);
      return token;
    } catch (err) {
      const is401 = err.message?.includes('HTTP 401') && err.message?.includes('key_not_found');
      if (is401 && attempt < retries) {
        console.warn(`[hub] ⚠️  key_not_found — retrying auth in 2s (attempt ${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
}

function makeHeaders(token, creds) {
  return {
    'Content-Type':   'application/json',
    'x-api-key':      creds.hubApiKey,
    'X-Access-Token': token,
    'X-environment':  creds.xEnvironment,
  };
}

// ─── Step 3: Encrypt Body ─────────────────────────────────────────────────────
async function encryptBody(body, token, creds) {
  console.log('[hub] Step 3 — encrypting body');
  try {
    const res = await axios.post(`${creds.supplierBaseUrl}/api/v1/encrypt-body`, body, {
      headers: makeHeaders(token, creds),
    });
    return res.data.encrypted ?? res.data;
  } catch (err) { apiError('encryptBody', err); }
}

// ─── Step 4: Submit Order ─────────────────────────────────────────────────────
async function submitOrder(encrypted, token, creds) {
  console.log('[hub] Step 4 — submitting order');
  try {
    const res = await axios.post(
      `${creds.supplierBaseUrl}/api/v1/topup/orders`,
      { encrypted },
      { headers: makeHeaders(token, creds) },
    );
    return res.data;
  } catch (err) { apiError('submitOrder', err); }
}

// ─── Step 5: Decrypt Response ─────────────────────────────────────────────────
async function decryptBody(encrypted, token, creds) {
  console.log('[hub] Step 5 — decrypting response');
  try {
    const res = await axios.post(
      `${creds.supplierBaseUrl}/api/v1/decrypt-body`,
      { encrypted },
      { headers: makeHeaders(token, creds) },
    );
    return res.data;
  } catch (err) { apiError('decryptBody', err); }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectOS(userAgent = '') {
  if (/android/i.test(userAgent))          return 'Android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS';
  return 'Android';
}

/**
 * Parse coins count from product name.
 * Handles formats:
 *   "600,000 كوينز - ماسا"  → 600000
 *   "600.000 كوينز - ماسا"  → 600000
 *   "ماسا تست 1 كوينز"       → 1
 */
function parseCoins(productName = '') {
  const match = productName.match(/([\d][,،.\d]*)/);
  if (!match) return null;
  const num = parseInt(match[1].replace(/[,،.]/g, ''), 10);
  return isNaN(num) ? null : num;
}

/**
 * Detect brand code by looking up the product name in the DB brand_mappings table.
 * Any product that is NOT one of our configured brands resolves to 'UNKNOWN', so
 * the caller ignores the order entirely (never submitted/drafted to the Supplier
 * Hub). We deliberately do NOT derive a brandCode from the product name suffix —
 * that produced bogus codes (e.g. "يلا_لودو") that slipped past the skip filters
 * and got pushed to manual drafts.
 */
async function detectBrand(productName = '', dbClientId = null) {
  try {
    const brand = await resolveBrand(productName, dbClientId);
    if (brand) return brand;
    // DB reachable but no mapping → not our brand. Ignore it.
    console.warn(`[hub] ⚠️  No brand mapping for "${productName}" — marking UNKNOWN (order will be ignored). Fix: POST /brands { keyword: "...", brandCode: "..." }`);
  } catch (err) {
    // DB unavailable — we can't confirm the brand, so play it safe and ignore
    // rather than risk pushing a non-configured product to the Supplier Hub.
    console.warn(`[hub] ⚠️  Brand lookup failed for "${productName}" (${err.message}) — marking UNKNOWN (order will be ignored).`);
  }
  return { brandCode: 'UNKNOWN', credentialMode: null };
}

export async function detectBrandCode(productName = '') {
  return (await detectBrand(productName)).brandCode;
}

/**
 * Salla order status slugs where we must NOT fulfil the order yet — the payment
 * isn't confirmed (payment pending) or the order is gone (cancelled / refunded /
 * being restored). Delivering coins for any of these would mean shipping before
 * money is settled. NOTE: 'under_review' (بإنتظار المراجعة) is intentionally
 * fulfillable — orders are sent to the Supplier Hub while still under review.
 */
const NON_FULFILLABLE_STATUS_SLUGS = new Set([
  'payment_pending', // بإنتظار الدفع
  'canceled',        // ملغي
  'cancelled',
  'refunded',
  'restored',        // مسترجع
  'restoring',       // قيد الإسترجاع
  'deleted',         // محذوف
]);

/**
 * Whether a Salla order is in a state where we may send it to the Supplier Hub.
 * Accepts either the bare order object or a `{ data }` wrapper. When the payload
 * carries no status slug we assume it IS fulfillable, to preserve the prior
 * behavior for stripped webhook payloads.
 */
export function isOrderFulfillable(order) {
  const o = order?.data ?? order;
  const slug = o?.status?.slug ?? null;
  if (!slug) return true;
  return !NON_FULFILLABLE_STATUS_SLUGS.has(slug);
}

/**
 * Orders older than this many minutes (since creation) must NOT be auto-fulfilled —
 * they're held ('blocked') for manual review instead. A per-client
 * `blockOrdersAfterMinutes` value overrides this default; set it to 0 to disable.
 */
export const DEFAULT_STALE_CUTOFF_MIN = 5;

/** Effective stale cutoff (minutes) for a client. 0 / negative disables blocking. */
export function staleCutoffMinutes(tenantCreds) {
  const v = tenantCreds?.blockOrdersAfterMinutes;
  return (v == null) ? DEFAULT_STALE_CUTOFF_MIN : v;
}

/** Age of a Salla order in minutes since it was created, or null if no date. */
export function orderAgeMinutes(order) {
  const o = order?.data ?? order;
  const raw = o?.date?.date ?? o?.created_at?.date ?? o?.created_at ?? null;
  if (!raw) return null;
  const s = String(raw).replace(' ', 'T');
  // If the timestamp has no timezone, assume Asia/Riyadh (+03:00).
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
  const d = new Date(hasTz ? s : `${s.replace(/\.\d+$/, '')}+03:00`);
  return isNaN(d.getTime()) ? null : (Date.now() - d.getTime()) / 60000;
}

/**
 * Whether an order is too old to auto-fulfil (passed the stale cutoff). Orders with
 * no parseable date are treated as NOT too old, to avoid blocking on bad data.
 */
export function isOrderTooOld(order, tenantCreds) {
  const cutoff = staleCutoffMinutes(tenantCreds);
  if (!cutoff || cutoff <= 0) return false;
  const age = orderAgeMinutes(order);
  return age != null && age > cutoff;
}

function parseOrderDate(order) {
  const raw = order?.date?.date ?? order?.created_at?.date ?? order?.created_at ?? null;
  if (!raw) return new Date().toISOString();
  try {
    return new Date(String(raw).replace(' ', 'T')).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// ─── Build Order Body from Salla Order ───────────────────────────────────────

export async function buildOrderBody(sallaOrder, tenantCreds) {
  const creds    = resolveCreds(tenantCreds);
  const order    = sallaOrder?.data ?? sallaOrder;
  // Build one entry per item — an order can contain multiple products.
  const items    = (order?.items ?? []).length ? order.items : [{}];
  const ua       = order?.source_details?.['user-agent'] ?? '';
  const orderDateTime = parseOrderDate(order);
  const OS            = detectOS(ua);
  const baseOrderNumber = String(order.reference_id ?? order.id);
  // The supplier rejects a repeated orderNumber ("repeat orders"), so when an
  // order has multiple products each one needs a unique number. Suffix with the
  // 1-based item index (deterministic across retries) — single-item orders keep
  // the plain reference so existing reconciliation is unaffected.
  const multiItem = items.length > 1;

  return Promise.all(items.map(async (item, i) => {
    const orderNumber = multiItem ? `${baseOrderNumber}-${i + 1}` : baseOrderNumber;
    // playerId can live on the item's own options; fall back to the
    // order-level playerId, then the default.
    const playerId = extractOptionValue(item.options ?? [], creds.playerIdField)
      ?? order?.playerId
      ?? '1';
    if (playerId === '1') {
      console.warn(`[hub] ⚠️  No playerId found for order ${orderNumber} item "${item.name ?? ''}" — using default: 1`);
    }

    const { brandCode } = await detectBrand(item.name ?? '', creds.dbClientId);
    const coins = parseCoins(item.name ?? '');

    return {
      brandCode,
      orderNumber,
      orderDateTime,
      playerId,
      OS,
      Coins:         coins,
      quantity:      item.quantity ?? 1,
      sku:           `${brandCode}_${coins}`,
      // Every order forwarded from Salla to SupplierHub must carry the client
      // credential mode, regardless of brand mapping. SupplierHub only accepts
      // "MASTER" or "CLIENT" (uppercase).
      credentialMode: 'CLIENT',
    };
  }));
}

// ─── Notify Supplier Hub of order status ─────────────────────────────────────

export async function notifySupplierStatus(orderRef, status = 'pending', tenantCreds) {
  const creds = resolveCreds(tenantCreds);
  try {
    const token = await getAuthToken(creds);
    await axios.patch(
      `${creds.supplierBaseUrl}/api/v1/order-status/${orderRef}`,
      { status },
      { headers: makeHeaders(token, creds) },
    );
    console.log(`[hub] 📡 Supplier Hub notified — order ${orderRef} → ${status}`);
  } catch (err) {
    const body = JSON.stringify(err.response?.data ?? err.message);
    console.warn(`[hub] ⚠️  notifySupplierStatus failed for ${orderRef}: ${body}`);
  }
}

// ─── Send Failed Order as Draft (manual execution) ───────────────────────────

// Sends one draft per entry — an order can contain multiple products, each of
// which may need manual execution. `reason` is the upstream failure that forced
// the fallback (e.g. "generateApiKey failed — HTTP 522"); it is forwarded to the
// hub so the manual queue shows WHY the order landed there.
//
// `credentialMode` is forwarded too: the hub never queues a CLIENT-mode order for
// manual execution (it runs on the client's own supplier account) and answers
// 422 CLIENT_MODE_NO_MANUAL_QUEUE. Such a product is skipped so the others still
// get drafted; when every product is refused, this throws (draft not sent).
export async function sendOrderDraft(orderBody, tenantCreds, reason) {
  const creds   = resolveCreds(tenantCreds);
  const entries = Array.isArray(orderBody) ? orderBody : [orderBody];
  const token   = await getAuthToken(creds);
  const results = [];
  const refused = [];
  const draftReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 2000) : null;

  for (const entry of entries) {
    const draftBody = {
      brandCode:     entry.brandCode,
      orderNumber:   entry.orderNumber,
      orderDateTime: entry.orderDateTime,
      playerId:      entry.playerId,
      Coins:         entry.Coins,
      OS:            entry.OS,
      sku:           entry.sku ?? `${entry.brandCode}_${entry.Coins}`,
      quantity:      entry.quantity ?? 1,
      ...(entry.credentialMode ? { credentialMode: entry.credentialMode } : {}),
      ...(draftReason ? { draftReason } : {}),
    };

    console.log(`[hub] 📋 Sending draft order ${draftBody.orderNumber} (${draftBody.sku})...`);
    try {
      const res = await axios.post(
        `${creds.supplierBaseUrl}/api/v1/order-draft`,
        draftBody,
        { headers: makeHeaders(token, creds) },
      );
      console.log(`[hub] ✅ Draft sent — order ${draftBody.orderNumber} (${draftBody.sku})`);
      results.push(res.data);
    } catch (err) {
      if (err.response?.data?.code !== 'CLIENT_MODE_NO_MANUAL_QUEUE') throw err;
      console.warn(`[hub] ⛔ Draft refused — order ${draftBody.orderNumber} (${draftBody.sku}) runs on the client's own account, not queued for manual execution`);
      refused.push(err.response.data.message ?? draftBody.sku);
    }
  }

  if (!results.length && refused.length) {
    throw new Error(`[hub] draft refused — ${refused.join(' | ')}`);
  }
  return results;
}

// ─── Main Flow ───────────────────────────────────────────────────────────────

/**
 * Submit a single order entry (one product) end-to-end: encrypt → submit →
 * decrypt. The supplier's topup endpoint only ever processes ONE product per
 * request — when handed an array it silently executes element [0] and drops the
 * rest — so every product in a multi-item order must be submitted on its own.
 * The body stays an array (`[entry]`) to match the wire format the supplier
 * already accepts.
 */
async function submitEntry(entry, token, creds) {
  const encrypted   = await encryptBody([entry], token, creds);
  const orderResult = await submitOrder(encrypted, token, creds);
  const encryptedResponse = orderResult?.encrypted ?? orderResult?.data?.encrypted ?? null;
  const decrypted = encryptedResponse
    ? await decryptBody(encryptedResponse, token, creds)
    : orderResult;
  // Normalize to a single response object (supplier may wrap it in an array).
  return decrypted?.[0] ?? decrypted;
}

/**
 * Submit every entry in an order body individually, one request per product.
 * Authenticates once and reuses the token. A failure on one product is captured
 * as an error response instead of aborting the batch — that way products that
 * already succeeded are never re-submitted (which would double-deliver coins),
 * and the caller can draft only the ones that failed.
 */
async function submitEntries(orderBody, creds) {
  const token = await getAuthToken(creds);
  console.log('[hub] Token acquired');

  const orderResponse = [];
  for (const entry of orderBody) {
    try {
      const res = await submitEntry(entry, token, creds);
      console.log(`[hub] Order submitted (${entry.sku}):`, JSON.stringify(res));
      orderResponse.push(res);
    } catch (err) {
      console.error(`[hub] ❌ submit failed for ${entry.sku}: ${err.message}`);
      orderResponse.push({ status: 'error', code: 'SUBMIT_FAILED', message: err.message, sku: entry.sku });
    }
  }

  return { orderBody, orderResponse };
}

/**
 * Summarize a per-item orderResponse array into a single verdict. Treats an
 * order as successful only when EVERY product succeeded.
 */
export function summarizeResponses(orderResponse, orderBody = []) {
  const responses = Array.isArray(orderResponse) ? orderResponse : [orderResponse];
  const items = responses.map((res, i) => ({
    res,
    entry: orderBody[i] ?? null,
    ok:    res?.status === 'success',
  }));
  const succeeded = items.filter((it) => it.ok);
  const failed    = items.filter((it) => !it.ok);

  return {
    items,
    succeeded,
    failed,
    allSuccess:   items.length > 0 && failed.length === 0,
    anyFailed:    failed.length > 0,
    providerRefs: succeeded.map((it) => it.res?.providerRef).filter(Boolean),
    errors:       failed.map((it) =>
      `${it.entry?.sku ? `${it.entry.sku} → ` : ''}${it.res?.code ?? 'UNKNOWN'}: ${it.res?.message ?? 'no message'}`),
  };
}

/**
 * Run the full flow against a pre-built order body array.
 * Used by tests and retries where the body is already constructed.
 */
export async function submitOrderBody(orderBody, tenantCreds) {
  const creds = resolveCreds(tenantCreds);
  console.log('[hub] Order body:', JSON.stringify(orderBody));
  return submitEntries(orderBody, creds);
}

/**
 * Full SupplierHub top-up flow for a Salla order:
 *   1. Generate API key  (handshake-api → api_key)
 *   2. Get access token  (supplier /auth/validate → access_token)
 *   3. For EACH product: encrypt → submit → decrypt (one request per product)
 */
export async function processOrder(sallaOrder, tenantCreds) {
  const creds     = resolveCreds(tenantCreds);
  const orderBody = await buildOrderBody(sallaOrder, tenantCreds);
  console.log('[hub] Order body:', JSON.stringify(orderBody));
  return submitEntries(orderBody, creds);
}
