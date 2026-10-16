import express from 'express';
import { randomUUID } from 'crypto';
import {
  listClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  getClientStores,
} from '../models/client.js';
import { saveToken } from '../services/sallaTokenService.js';
import { getLogs, clearLogs } from '../services/logBuffer.js';

const router = express.Router();

const PUBLIC_URL = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
function buildRedirectUri(slug) {
  return `${PUBLIC_URL}/salla/callback/${slug}`;
}

// Coerce the per-client stale-order cutoff into a positive integer of minutes,
// or null when empty/blank/zero (meaning: no cutoff).
function normalizeBlockMinutes(val) {
  if (val == null || val === '') return null;
  const n = parseInt(val, 10);
  if (isNaN(n) || n <= 0) return null;
  return n;
}

// Auth is enforced by requireAuth where this router is mounted in index.js.

// ── GET /admin/clients ─────────────────────────────────────────
router.get('/clients', async (_req, res) => {
  try {
    const clients = await listClients();
    res.json({ ok: true, data: clients });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /admin/clients/:id ─────────────────────────────────────
router.get('/clients/:id', async (req, res) => {
  try {
    const client = await getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ ok: true, data: client });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /admin/clients ────────────────────────────────────────
router.post('/clients', async (req, res) => {
  try {
    const {
      name, slug, sallaClientId, sallaClientSecret,
      sallaWebhookSecret, hubApiKey, clientId, telegramBotToken, telegramChatId,
      blockOrdersAfterMinutes, isActive,
    } = req.body;

    if (!name || !slug || !sallaClientId || !sallaClientSecret) {
      return res.status(400).json({
        error: 'name, slug, sallaClientId, and sallaClientSecret are required',
      });
    }

    const client = await createClient({
      name, slug, sallaClientId, sallaClientSecret,
      sallaRedirectUri: buildRedirectUri(slug),
      sallaWebhookSecret:  sallaWebhookSecret  ?? null,
      ...(hubApiKey         != null && { hubApiKey }),
      ...(clientId          != null && { masaClientId: clientId }),
      ...(telegramBotToken  != null && { telegramBotToken }),
      ...(telegramChatId    != null && { telegramChatId }),
      blockOrdersAfterMinutes: normalizeBlockMinutes(blockOrdersAfterMinutes),
      isActive:            isActive ?? true,
    });
    res.status(201).json({ ok: true, data: client });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A client with that slug already exists' });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PUT /admin/clients/:id ─────────────────────────────────────
router.put('/clients/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;
    delete updates.createdAt;
    delete updates.sallaRedirectUri;
    if ('clientId' in updates) {
      updates.masaClientId = updates.clientId;
      delete updates.clientId;
    }
    if ('blockOrdersAfterMinutes' in updates) {
      updates.blockOrdersAfterMinutes = normalizeBlockMinutes(updates.blockOrdersAfterMinutes);
    }
    if (updates.slug) {
      updates.sallaRedirectUri = buildRedirectUri(updates.slug);
    }
    const client = await updateClient(req.params.id, updates);
    res.json({ ok: true, data: client });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Client not found' });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /admin/clients/:id ──────────────────────────────────
router.delete('/clients/:id', async (req, res) => {
  try {
    await deleteClient(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Client not found' });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /admin/clients/:id/stores ──────────────────────────────
router.get('/clients/:id/stores', async (req, res) => {
  try {
    const stores = await getClientStores(req.params.id);
    res.json({ ok: true, data: stores });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /admin/clients/:id/stores ─────────────────────────────
// Manually link a Salla store to a client without OAuth.
// Body: { storeId, accessToken, refreshToken, expiresIn }
router.post('/clients/:id/stores', async (req, res) => {
  try {
    const client = await getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { storeId, accessToken, refreshToken, expiresIn = 1209599 } = req.body ?? {};
    if (!storeId || !accessToken || !refreshToken) {
      return res.status(400).json({ error: 'storeId, accessToken, and refreshToken are required' });
    }

    const record = await saveToken({ storeId, accessToken, refreshToken, expiresIn, clientId: client.id });
    res.status(201).json({ ok: true, data: record });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /admin/clients/:id/auth-url ───────────────────────────
// Returns the Salla OAuth URL for this client (merchant copies it to authorize)
router.get('/clients/:id/auth-url', async (req, res) => {
  try {
    const client = await getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const authUrl = new URL('https://accounts.salla.sa/oauth2/auth');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', client.sallaClientId);
    authUrl.searchParams.set('redirect_uri', buildRedirectUri(client.slug));
    authUrl.searchParams.set('scope', 'orders.read products.read offline_access');
    authUrl.searchParams.set('state', randomUUID());

    res.json({ ok: true, authUrl: authUrl.toString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /admin/logs ────────────────────────────────────────────
// Returns buffered server logs. Supports incremental polling via `sinceId`,
// level filtering, and a free-text search.
router.get('/logs', (req, res) => {
  try {
    const { level, search } = req.query;
    const limit   = req.query.limit   != null ? parseInt(req.query.limit, 10)   : 500;
    const sinceId = req.query.sinceId != null ? parseInt(req.query.sinceId, 10) : undefined;
    const result = getLogs({
      limit:   Number.isFinite(limit) ? limit : 500,
      level,
      sinceId: Number.isFinite(sinceId) ? sinceId : undefined,
      search,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /admin/logs ─────────────────────────────────────────
// Clears the in-memory log buffer (terminal/PM2 output is unaffected).
router.delete('/logs', (_req, res) => {
  clearLogs();
  res.json({ ok: true });
});

export default router;
