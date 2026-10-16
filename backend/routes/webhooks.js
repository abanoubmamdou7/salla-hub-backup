import express from 'express';
import { verifySallaWebhookSignature } from '../utils/validator.js';
import { handleSallaWebhook } from '../services/sallaWebhook.js';
import { saveToken } from '../services/sallaTokenService.js';
import { getClientBySlug } from '../models/client.js';

const router = express.Router();

// ─── Raw body parser (for signature verification) ──────────────────────────
const rawJsonParser = express.raw({ type: 'application/json', limit: '1mb' });

// ─── Shared webhook handler (used by both generic and per-client routes) ───
async function processSallaWebhook(req, res, overrideSecret, clientId, tenantCreds = null) {
  // Always acknowledge Salla immediately — never block
  res.status(200).json({ ok: true });

  const rawBody = req.body;
  const rawStr  = Buffer.isBuffer(rawBody)
    ? rawBody.toString('utf8')
    : typeof rawBody === 'string' ? rawBody : '';

  const eventType = req.get('x-salla-event') || '';
  const signature = req.get('x-salla-signature') || '';

  console.log(`[webhooks] Received — event: ${eventType || '(header not set)'}${clientId ? ` (client: ${clientId})` : ''}`);

  const secret = overrideSecret || '';
  if (secret) {
    if (!verifySallaWebhookSignature(rawStr, signature, secret)) {
      console.warn('[webhooks] ⚠️  Invalid signature — ignoring payload');
      return;
    }
  }

  let payload;
  try {
    payload = rawStr ? JSON.parse(rawStr) : {};
  } catch {
    console.error('[webhooks] Invalid JSON body — ignoring');
    return;
  }

  const ipRaw =
    (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    req.ip ||
    '';

  if (eventType === 'app.store.authorize') {
    const storeId      = payload.merchant ?? payload.store_id ?? payload.data?.store_id;
    const accessToken  = payload.data?.access_token;
    const refreshToken = payload.data?.refresh_token;
    const expiresIn    = payload.data?.expires_in ?? 3600;

    if (!storeId || !accessToken || !refreshToken) {
      console.error('[webhooks] app.store.authorize — missing required fields', {
        hasStoreId: !!storeId, hasAccess: !!accessToken, hasRefresh: !!refreshToken,
      });
      return;
    }

    saveToken({ storeId: String(storeId), accessToken, refreshToken, expiresIn, clientId: clientId ?? null })
      .then(() => console.log(`[webhooks] app.store.authorize — token saved for store ${storeId}`))
      .catch((err) => console.error(`[webhooks] app.store.authorize — failed to save token for store ${storeId}:`, err.message));
    return;
  }

  const result = handleSallaWebhook(payload, eventType, { customer_ip: ipRaw, tenantCreds });
  if (result.handled) {
    console.log(
      `[webhooks] Dispatched — event: ${result.event}, orderId: ${result.orderId}, storeId: ${result.storeId ?? 'n/a'}`
    );
  } else {
    console.log(`[webhooks] Skipped — not an order event (${result.event ?? 'unknown'})`);
  }
}

// ─── GET /webhooks/salla ───────────────────────────────────────────────────
router.get('/salla', (_req, res) => {
  res.status(200).json({ ok: true, message: 'Salla webhook endpoint ready' });
});

// ─── GET /webhooks/salla/:clientSlug ──────────────────────────────────────
router.get('/salla/:clientSlug', (_req, res) => {
  res.status(200).json({ ok: true, message: 'Salla webhook endpoint ready' });
});

// ─── POST /webhooks/salla/:clientSlug — per-client with its own secret ─────
router.post('/salla/:clientSlug', rawJsonParser, async (req, res) => {
  try {
    const client = await getClientBySlug(req.params.clientSlug);
    if (!client) {
      res.status(404).json({ error: 'Unknown client' });
      return;
    }
    await processSallaWebhook(req, res, client.sallaWebhookSecret || '', client.id, {
      telegramBotToken:  client.telegramBotToken,
      telegramChatId:    client.telegramChatId,
      dbClientId:        client.id,
      hubApiKey:         client.hubApiKey,
      clientId:          client.masaClientId,
      supplierBaseUrl:   client.supplierBaseUrl,
      supplierApiKeyUrl: client.supplierApiKeyUrl,
      xEnvironment:      client.xEnvironment,
      playerIdField:     client.playerIdField,
      blockOrdersAfterMinutes: client.blockOrdersAfterMinutes,
    });
  } catch (err) {
    console.error('[webhooks] per-client route error:', err.message);
  }
});

// ─── POST /webhooks/salla ──────────────────────────────────────────────────
router.post('/salla', rawJsonParser, (req, res) => {
  processSallaWebhook(req, res, '', null).catch((err) =>
    console.error('[webhooks] unhandled error:', err.message)
  );
});

export default router;
