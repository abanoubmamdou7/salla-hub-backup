import axios from 'axios';
import { getValidSallaToken } from './sallaTokenService.js';
import { getWebhookPayload } from '../models/order.js';

/**
 * Resolve a fresh access token for the given store from the DB-backed token manager.
 * @param {string} storeId
 * @returns {Promise<string>}
 */
async function ensureValidAccessToken(storeId) {
  if (!storeId) {
    throw new Error('No storeId provided — link this store to a client in the DB');
  }
  return getValidSallaToken(storeId);
}

const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';

/**
 * GET a Salla endpoint with automatic retry on 429 (rate limit). Salla throttles
 * per app, so brief bursts can return 429 — a short backoff resolves it.
 */
async function sallaGet(url, { headers, params, timeout = 15000, retries = 2, maxBackoffMs = 5000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await axios.get(url, { headers, params, timeout });
    } catch (err) {
      if (err.response?.status === 429 && attempt < retries) {
        const retryAfterSec = Number(err.response.headers?.['retry-after']);
        const waitMs = Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : (attempt + 1) * 1000;
        // Salla can return a very long Retry-After (quota exhausted, e.g. ~1h).
        // Never block the order flow that long — fail fast and let the caller
        // fall back (stored payload / draft) instead.
        if (waitMs > maxBackoffMs) {
          console.warn(`[sallaApi] 429 on ${url} — Retry-After ${Math.round(waitMs / 1000)}s exceeds cap (${maxBackoffMs}ms); failing fast`);
          throw err;
        }
        console.warn(`[sallaApi] 429 on ${url} — retrying in ${waitMs}ms (${attempt + 1}/${retries})`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Fetch order details from Salla API (light format).
 * format=light is the only supported response since Salla's 1 Sep 2026 Orders API
 * deprecation: it omits Shipments, Items, Pickup Branch and Customer Groups.
 * Items MUST come from fetchOrderItems / the webhook payload, never from here.
 * @param {string} orderId  - Salla order ID
 * @param {string} [storeId] - Required in multi-store mode
 * @returns {Promise<object>}
 */
export async function fetchOrder(orderId, storeId) {
  const accessToken = await ensureValidAccessToken(storeId);
  const response = await sallaGet(`${SALLA_API_BASE}/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params:  { format: 'light' },
  });
  return response.data?.data ?? response.data;
}

/**
 * Fetch an order's items WITH their options (custom fields like the player ID).
 * The order.created webhook payload and GET /orders/{id} both arrive stripped of
 * item options — this endpoint is the reliable source for them.
 *
 * @param {string} orderId
 * @param {string} [storeId]
 * @returns {Promise<object[]>} array of items, each with an `options` array
 */
export async function fetchOrderItems(orderId, storeId) {
  const accessToken = await ensureValidAccessToken(storeId);
  const response = await sallaGet(`${SALLA_API_BASE}/orders/items`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params:  { order_id: orderId },
  });
  return response.data?.data ?? [];
}

/**
 * Fetch a single product from Salla API.
 * @param {string} productId - Salla product ID
 * @param {string} [storeId]
 * @returns {Promise<object>}
 */
export async function fetchProduct(productId, storeId) {
  const accessToken = await ensureValidAccessToken(storeId);
  const response = await axios.get(`${SALLA_API_BASE}/products/${productId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15000,
  });
  return response.data?.data ?? response.data;
}

/**
 * Fetch a page of products from Salla API.
 * @param {{ page?: number, per_page?: number, keyword?: string, status?: string, storeId?: string }} [opts]
 * @returns {Promise<{ products: object[], pagination: object }>}
 */
export async function fetchProducts({ page = 1, per_page = 20, keyword, status, storeId } = {}) {
  const accessToken = await ensureValidAccessToken(storeId);
  const params = { page, per_page };
  if (keyword) params.keyword = keyword;
  if (status)  params.status  = status;

  const response = await axios.get(`${SALLA_API_BASE}/products`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params,
    timeout: 20000,
  });

  const body = response.data;
  return {
    products:   body.data ?? [],
    pagination: body.pagination ?? { currentPage: page, totalPages: 1, count: 0 },
  };
}

/**
 * Fetch ALL products across all pages from Salla API.
 * @param {{ per_page?: number, keyword?: string, status?: string, storeId?: string }} [opts]
 * @returns {Promise<object[]>}
 */
export async function fetchAllProducts({ per_page = 100, keyword, status, storeId } = {}) {
  const all = [];
  let page = 1;
  let totalPages = 1;

  do {
    const { products, pagination } = await fetchProducts({ page, per_page, keyword, status, storeId });
    all.push(...products);
    totalPages = pagination.totalPages ?? pagination.last_page ?? 1;
    page++;
  } while (page <= totalPages);

  return all;
}

/**
 * Fetch the webhook log payload for a specific order (order.created event).
 * This is the only way to retrieve item options (e.g. playerId) via the API,
 * because GET /orders/{id} does not return options.
 *
 * @param {string} orderId
 * @param {string} [storeId]
 * @returns {Promise<object|null>} - parsed order payload, or null if not found
 */
export async function fetchOrderFromWebhookLog(orderId, storeId) {
  const accessToken = await ensureValidAccessToken(storeId);
  const response = await axios.get(`${SALLA_API_BASE}/webhooks/logs`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params:  { event: 'order.created', limit: 50 },
    timeout: 15000,
  });

  const logs = response.data?.data ?? {};
  for (const entry of Object.values(logs)) {
    const payloadStr = entry?.summary?.payload;
    if (!payloadStr) continue;
    try {
      const parsed = JSON.parse(payloadStr);
      if (String(parsed?.data?.id) === String(orderId)) {
        return parsed.data;
      }
    } catch {
      // malformed payload — skip
    }
  }
  return null;
}

/**
 * Fetch order details from Salla API and enrich with item options (playerId, etc.)
 * from the webhook log, since GET /orders/{id} never returns item options.
 *
 * @param {string} orderId
 * @param {string} [storeId]
 * @returns {Promise<object>}
 */
export async function fetchOrderWithOptions(orderId, storeId, playerIdField = 'الأيدي') {
  const [order, apiItemsRes, stored] = await Promise.allSettled([
    fetchOrder(orderId, storeId),
    fetchOrderItems(orderId, storeId),
    getWebhookPayload(orderId),
  ]);

  const storedPayload = stored.status === 'fulfilled' ? stored.value : null;
  const storedData    = storedPayload ? (storedPayload?.data ?? storedPayload) : null;

  // Prefer live order details, but fall back to the captured webhook payload if
  // the details call fails (e.g. a transient 429) so order-level fields survive.
  let orderData = order.status === 'fulfilled' ? order.value : null;
  if (!orderData) orderData = storedData;
  if (!orderData) throw new Error(`Failed to fetch order ${orderId}: ${order.reason?.message}`);

  // Item options (the player ID) arrive on different sources unreliably: GET
  // /orders/{id} and /orders/items both frequently come back stripped of them,
  // while the order.created webhook payload we cached on arrival reliably carries
  // them. "Has items" is NOT enough — picking an option-less source silently drops
  // the player ID. So gather every source and prefer whichever one actually carries
  // the configured player-ID option.
  const apiItems     = apiItemsRes.status === 'fulfilled' ? apiItemsRes.value : null;
  const webhookItems = storedData?.items?.length ? storedData.items : null;

  const candidates = [webhookItems, apiItems, orderData.items].filter((c) => c?.length);
  let chosen = candidates.find((items) => getOrderOption({ items }, playerIdField));

  // Last resort: the webhook-logs API (last 50 events, often misses the order).
  if (!chosen) {
    try {
      const logData = await fetchOrderFromWebhookLog(orderId, storeId);
      if (logData?.items?.length) {
        candidates.push(logData.items);
        if (getOrderOption(logData, playerIdField)) chosen = logData.items;
      }
    } catch (err) {
      console.warn(`[sallaApi] webhook-log fallback failed for ${orderId}: ${err.message}`);
    }
  }

  // No source carried the option — keep the richest item list we have so the rest
  // of the pipeline (product name, brand, coins) still works; the missing player ID
  // is surfaced downstream.
  if (!chosen) chosen = candidates[0] ?? orderData.items ?? [];
  orderData.items = chosen;

  // Expose playerId at the top level for convenience
  const playerId = getOrderOption(orderData, playerIdField);
  if (playerId) orderData.playerId = playerId;

  return orderData;
}

/**
 * Extract a named option value from an order's items.
 * Works with both the webhook payload (has options) and API response (no options).
 *
 * @param {object} orderData  - order object from webhook payload or API
 * @param {string} optionName - e.g. "الأيدي"
 * @returns {string|null}
 */
/** Normalize Arabic text for fuzzy matching (removes hamza variants, tatweel, tashkeel). */
function normalizeAr(str = '') {
  return str
    .replace(/[أإآ]/g, 'ا')
    .replace(/\u0640/g, '')       // tatweel
    .replace(/[\u064B-\u065F]/g, '') // tashkeel
    .toLowerCase()
    .trim();
}

// Common labels merchants use for the player-ID field, beyond the per-client
// configured one. Matching any of these makes extraction resilient to products
// that name the field slightly differently (a very common cause of failures).
const PLAYER_ID_SYNONYMS = [
  'الايدي', 'ايدي', 'اي دي', 'رقم الايدي', 'رقم اللاعب', 'اللاعب',
  'ايدي اللاعب', 'معرف اللاعب', 'id', 'player id', 'playerid', 'user id', 'uid',
];

/** Read an option's value, tolerating object-shaped values (dropdowns, etc.). */
function readOptionValue(option) {
  let v = option?.value;
  if (v && typeof v === 'object') {
    v = v.name ?? v.value ?? v.label ?? v.title ?? null;
  }
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Find the player-ID option within a single options array.
 * Matches the configured field name (bidirectional) OR any known synonym.
 * @returns {string|null} the option value, or null
 */
export function extractOptionValue(options = [], optionName = '') {
  const configured = normalizeAr(optionName);

  for (const o of options) {
    const name = normalizeAr(o?.name ?? '');
    if (!name) continue;
    // Configured field is matched bidirectionally (short label vs. full Salla
    // label); synonyms only one-way (name must contain the synonym) to avoid
    // short tokens like "id" over-matching.
    const hit =
      (configured && (name.includes(configured) || configured.includes(name))) ||
      PLAYER_ID_SYNONYMS.some((syn) => name.includes(normalizeAr(syn)));
    if (hit) {
      const val = readOptionValue(o);
      if (val) return val;
    }
  }
  return null;
}

export function getOrderOption(orderData, optionName) {
  const items = orderData?.items ?? [];
  for (const item of items) {
    const val = extractOptionValue(item.options ?? [], optionName);
    if (val) return val;
  }
  return null;
}

/**
 * Diagnostic: list every option (name=value) across all items, so a failed
 * player-ID extraction reveals the actual field labels we received.
 */
export function describeOptions(orderData) {
  const items = orderData?.items ?? [];
  const lines = [];
  for (const item of items) {
    for (const o of item.options ?? []) {
      const val = readOptionValue(o);
      // Show name=value when we can read a value; otherwise dump the whole option
      // object so we can see which key actually holds the data.
      lines.push(val != null
        ? `${o?.name ?? '(no-name)'} = ${val}`
        : `${o?.name ?? '(no-name)'} → ${JSON.stringify(o)}`);
    }
  }
  return lines;
}

/**
 * Fetch a page of orders from Salla API.
 * @param {{ page?: number, per_page?: number, status?: string, storeId?: string }} [opts]
 * @returns {Promise<{ orders: object[], pagination: object }>}
 */
export async function fetchOrders({ page = 1, per_page = 20, status, storeId } = {}) {
  const accessToken = await ensureValidAccessToken(storeId);
  const params = { page, per_page };
  if (status) params.status = status;

  const response = await axios.get(`${SALLA_API_BASE}/orders`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params,
    timeout: 30000,
  });

  const body = response.data;
  return {
    orders:     body.data ?? [],
    pagination: body.pagination ?? { currentPage: page, totalPages: 1, count: 0 },
  };
}
