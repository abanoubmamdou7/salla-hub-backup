import { processOrderFromWebhook } from './orderProcessor.js';
import { saveWebhookPayload } from '../models/order.js';

const ORDER_EVENTS = new Set([
  'order.created',
  'order.updated',
  'order.status.updated',
  'order.cancelled',
  'order.refunded',
  'order.deleted',
  'order.products.updated',
  'order.payment.updated',
  'order.coupon.updated',
  'order.total.price.updated',
]);

// Invoice events that should trigger order processing
const INVOICE_EVENTS = new Set([
  'invoice.created',
]);

/**
 * Handle an incoming Salla webhook payload.
 * Extracts event type, order ID, and store ID, then triggers async processing.
 *
 * @param {object} payload          - Parsed webhook body
 * @param {string} [eventFromHeader] - Value of the x-salla-event header (takes priority)
 * @param {{ customer_ip?: string }} [ctx] - Optional context (e.g. client IP from proxy)
 * @returns {{ handled: boolean, orderId?: string, event?: string, storeId?: string }}
 */
export function handleSallaWebhook(payload, eventFromHeader, ctx = {}) {
  if (!payload || typeof payload !== 'object') {
    return { handled: false };
  }

  // Event type: header > body.event > body.name
  const event = eventFromHeader || payload.event || payload.name;

  const data = payload.data || payload;

  // Order ID — invoice events nest it under data.order_id or data.order.id
  let orderId =
    data.order_id    ??
    data.order?.id   ??
    data.id          ??
    null;

  // Store ID from common payload shapes
  const storeId =
    payload.store_id ??
    data.store_id    ??
    data.merchant_id ??
    data.store?.id   ??
    null;

  const isOrderEvent   = ORDER_EVENTS.has(event);
  const isInvoiceEvent = INVOICE_EVENTS.has(event);

  if ((!isOrderEvent && !isInvoiceEvent) || !orderId) {
    console.log(`[sallaWebhook] Ignored — event: ${event || '(none)'}, orderId: ${orderId ?? '(none)'}`);
    return { handled: false, event };
  }

  // DISABLE_WEBHOOK=true → poller-only mode
  if (process.env.DISABLE_WEBHOOK === 'true') {
    console.log(`[sallaWebhook] Webhook disabled (DISABLE_WEBHOOK=true) — poller will handle order ${orderId}`);
    return { handled: false, event };
  }

  // Capture the raw payload on arrival so the poller can read item options
  // (e.g. the player ID) from it — the REST API never returns them. Only store
  // payloads that actually carry items, so an option-less event (e.g. an invoice
  // update) can never overwrite a good order.created payload. Fire-and-forget.
  if (data?.items?.length) {
    saveWebhookPayload(String(orderId), payload, event).catch((err) =>
      console.warn(`[sallaWebhook] Failed to cache payload for ${orderId}: ${err.message}`)
    );
  }

  // Fire-and-forget — route has already sent 200
  processOrderFromWebhook(String(orderId), {
    storeId:      storeId ? String(storeId) : undefined,
    eventType:    event,
    rawPayload:   payload,
    tenantCreds:  ctx.tenantCreds ?? null,
    customer_ip:  ctx.customer_ip,
  }).catch((err) => {
    console.error(`[sallaWebhook] processOrderFromWebhook failed for ${orderId}:`, err.message);
  });

  return { handled: true, orderId: String(orderId), event, storeId: storeId ? String(storeId) : null };
}
