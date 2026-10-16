import { initLogCapture } from './services/logBuffer.js';
initLogCapture(); // patch console first so all startup logs are captured

import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import { readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { initDatabase } from './config/database.js';
import webhooksRouter from './routes/webhooks.js';
import ordersRouter from './routes/orders.js';
import productsRouter from './routes/products.js';
import { startOrderPoller } from './services/orderPoller.js';
import { listPollLogs } from './models/pollLog.js';
import { getOrderByRef, updateOrderStatus } from './models/order.js';
import storeProductsRouter from './routes/storeProducts.js';
import brandsRouter from './routes/brands.js';
import adminRouter from './routes/admin.js';
import { getValidSallaToken, saveToken, startTokenRefreshScheduler, TokenNotFoundError, TokenRefreshError } from './services/sallaTokenService.js';
import { findTokenByStoreId } from './db/tokenRepository.js';
import { formatTimeRemaining, needsRefresh } from './helpers/tokenExpiry.js';
import { getClientBySlug, listClients } from './models/client.js';
import authRouter from './routes/auth.js';
import { seedAdminFromEnv } from './services/authService.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const PUBLIC_URL = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
function buildRedirectUri(slug) {
  return `${PUBLIC_URL}/salla/callback/${slug}`;
}

app.use(cors());

// Webhooks must receive raw body for signature verification; mount before json parser
app.use('/webhooks', webhooksRouter);
app.use(express.json({ limit: '1mb' }));

// Authentication (email + password, optional Google Authenticator 2FA).
// /auth/login and /auth/2fa/verify are public; the rest require a session.
app.use('/auth', authRouter);

// Dashboard-facing data + admin routes (login removed — open access).
app.use('/orders', ordersRouter);
app.use('/products', productsRouter);
app.use('/stores', storeProductsRouter);
app.use('/brands', brandsRouter);
app.use('/admin', adminRouter);

// Token file path
const TOKENS_FILE = 'tokens.json';

// Helper: Check if token is expired (with safety margin)
function isExpired(expires_at, skewSeconds = 60) {
  return Date.now() >= (expires_at - skewSeconds * 1000);
}

// Helper: Check if token expires within given seconds (for proactive refresh)
function expiresWithin(expires_at, withinSeconds) {
  return Date.now() >= (expires_at - withinSeconds * 1000);
}

// Helper: Perform token refresh (returns updated tokens object)
async function doRefreshToken(tokens) {
  const tokenParams = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: tokens.refresh_token
  });
  const tokenResponse = await axios.post(
    'https://accounts.salla.sa/oauth2/token',
    tokenParams.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const { token_type, expires_in, scope, access_token, refresh_token: new_refresh_token } = tokenResponse.data;
  const expires_at = Date.now() + (expires_in * 1000);
  return {
    access_token,
    refresh_token: new_refresh_token || tokens.refresh_token,
    token_type,
    scope,
    expires_at
  };
}

// Helper: Read tokens from file
async function readTokens() {
  try {
    if (!existsSync(TOKENS_FILE)) {
      return null;
    }
    const data = await readFile(TOKENS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Error reading tokens.json:', error.message);
    return null;
  }
}

// Helper: Write tokens to file
async function writeTokens(tokens) {
  try {
    await writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf8');
    console.log('💾 Saved tokens.json');
  } catch (error) {
    console.error('❌ Error writing tokens.json:', error.message);
    throw error;
  }
}

// ─── PATCH /api/v1/order-status/:orderRef ────────────────────────────────────
// Change order status + release lock so poller retries it.
// Body: { "status": "pending" }  (default: "pending")
app.patch('/api/v1/order-status/:orderRef', async (req, res) => {
  const { orderRef } = req.params;
  const status = req.body?.status ?? 'pending';
  const allowed = ['pending', 'sent', 'failed'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ ok: false, error: `status must be one of: ${allowed.join(', ')}` });
  }
  try {
    const order = await getOrderByRef(orderRef);
    if (!order) return res.status(404).json({ ok: false, error: `Order "${orderRef}" not found` });

    await updateOrderStatus(order.salla_order_id, status);
    res.json({
      orderRef,
      salla_order_id: order.salla_order_id,
      status,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /poll-logs — last N poll cycles with stats
app.get('/poll-logs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const logs  = await listPollLogs(limit);
    res.json({ ok: true, count: logs.length, logs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Route: Get server's outbound IP (what external APIs see)
app.get('/ip', async (_req, res) => {
  try {
    const r = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
    res.json({ outbound_ip: r.data.ip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route 1: List all clients with their OAuth URLs
app.get('/', async (_req, res) => {
  try {
    const clients = await listClients();
    const lines = clients.map((c) => {
      const authUrl = new URL('https://accounts.salla.sa/oauth2/auth');
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', c.sallaClientId);
      authUrl.searchParams.set('redirect_uri', buildRedirectUri(c.slug));
      authUrl.searchParams.set('scope', 'orders.read products.read offline_access');
      authUrl.searchParams.set('state', randomUUID());
      return `[${c.isActive ? 'ACTIVE' : 'INACTIVE'}] ${c.name}  (slug: ${c.slug})\n  Direct: GET /salla/auth/${c.slug}\n  OAuth URL:\n  ${authUrl.toString()}`;
    });

    const body = clients.length
      ? `Salla Hub — Clients & OAuth URLs\n${'='.repeat(60)}\n\n${lines.join('\n\n')}\n\n${'='.repeat(60)}`
      : `Salla Hub\n${'='.repeat(60)}\nNo clients configured yet.\nAdd clients via the dashboard or POST /admin/clients.`;

    res.type('text/plain').send(body);
  } catch (err) {
    res.status(500).type('text/plain').send(`Error: ${err.message}`);
  }
});

// Route: Per-client OAuth start — GET /salla/auth/:clientSlug
app.get('/salla/auth/:clientSlug', async (req, res) => {
  try {
    const client = await getClientBySlug(req.params.clientSlug);
    if (!client) return res.status(404).type('text/plain').send(`Client "${req.params.clientSlug}" not found`);
    if (!client.isActive) return res.status(403).type('text/plain').send('Client is inactive');

    const authUrl = new URL('https://accounts.salla.sa/oauth2/auth');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', client.sallaClientId);
    authUrl.searchParams.set('redirect_uri', buildRedirectUri(client.slug));
    authUrl.searchParams.set('scope', 'orders.read products.read offline_access');
    authUrl.searchParams.set('state', randomUUID());

    res.redirect(authUrl.toString());
  } catch (err) {
    res.status(500).type('text/plain').send(`Error: ${err.message}`);
  }
});

// Route 2: OAuth callback - exchange code for access token
app.get('/salla/callback/:slug', async (req, res) => {
  const { code, error, error_description } = req.query;
  const { slug } = req.params;

  if (error) {
    console.error('❌ OAuth error:', error);
    console.error('   Description:', error_description);
    return res.status(400).type('text/plain').send(`OAuth Error: ${error}\nDescription: ${error_description || 'No description provided'}`);
  }

  if (!code) {
    console.error('❌ Missing code');
    return res.status(400).type('text/plain').send('Missing code');
  }

  // Identify client by slug from the URL path
  const client = await getClientBySlug(slug).catch(() => null);
  if (!client) {
    return res.status(404).type('text/plain').send(`No client found for slug "${slug}".`);
  }

  const resolvedClientId = client.sallaClientId;
  const resolvedSecret   = client.sallaClientSecret;
  const resolvedRedirect = buildRedirectUri(slug);
  const dbClientId       = client.id;

  console.log('✅ Authorization code received for client:', slug);
  console.log('📤 Exchanging code — client_id:', resolvedClientId, '| redirect_uri:', resolvedRedirect);

  try {
    // Exchange code for access token
    const tokenParams = new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     resolvedClientId,
      client_secret: resolvedSecret,
      redirect_uri:  resolvedRedirect,
      code,
    });

    const tokenResponse = await axios.post(
      'https://accounts.salla.sa/oauth2/token',
      tokenParams.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const { token_type, expires_in, scope, access_token, refresh_token } = tokenResponse.data;

    // Calculate expiration timestamp
    const expires_at = Date.now() + (expires_in * 1000);

    // Save tokens to file (legacy path)
    await writeTokens({
      access_token,
      refresh_token,
      token_type,
      scope,
      expires_at
    });

    // Also save to DB for production auto-refresh via sallaTokenService
    try {
      const storeInfoRes = await axios.get('https://api.salla.dev/admin/v2/store/info', {
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: 10_000,
      });
      const storeId = String(storeInfoRes.data?.data?.id ?? storeInfoRes.data?.id ?? '');
      if (storeId) {
        await saveToken({ storeId, accessToken: access_token, refreshToken: refresh_token, expiresIn: expires_in, clientId: dbClientId });
        console.log(`✅ Token saved to DB for storeId: ${storeId}`);
        console.log(`   Store ${storeId} linked to client in DB.`);
      }
    } catch (dbErr) {
      // Non-fatal — file-based token still saved above
      console.warn('⚠️  Could not save token to DB:', dbErr.message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 SUCCESS! Access Token Retrieved:');
    console.log('='.repeat(60));
    console.log('ACCESS_TOKEN:', access_token);
    console.log('Token Type:', token_type);
    console.log('Expires In:', expires_in, 'seconds');
    console.log('Scope:', scope);
    console.log('='.repeat(60));

    // Return plain text response with all token details
    res.type('text/plain').send(`
OAuth Success!
==============

Token Type: ${token_type}
Expires In: ${expires_in} seconds (${Math.round(expires_in / 60)} minutes)
Scope: ${scope}

Access Token:
${access_token}

Refresh Token:
${refresh_token}

---

POSTMAN USAGE:
==============
Copy the access token above and use it in Postman to test Salla API:

Request:
  Method: GET
  URL: https://api.salla.dev/admin/v2/orders
  Header: Authorization: Bearer ${access_token}

Example cURL:
  curl -X GET "https://api.salla.dev/admin/v2/orders" \\
       -H "Authorization: Bearer ${access_token}"

⚠️  Note: This token will expire in ${Math.round(expires_in / 60)} minutes.
    `.trim());

  } catch (error) {
    console.error('❌ Error during token exchange:');
    
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
      
      return res.status(error.response.status).type('text/plain').send(`
Error: ${error.message}
Status: ${error.response.status}
Details: ${JSON.stringify(error.response.data, null, 2)}
      `.trim());
    } else {
      console.error('   Message:', error.message);
      return res.status(500).type('text/plain').send(`Error: ${error.message}`);
    }
  }
});

// Route 3: Refresh access token using refresh token
app.get('/salla/refresh', async (_req, res) => {
  console.log('🔄 Refresh token request received');

  try {
    // Read current tokens
    const tokens = await readTokens();
    
    if (!tokens || !tokens.refresh_token) {
      console.error('❌ No refresh token found in tokens.json');
      return res.status(400).type('text/plain').send('No refresh token found. Please complete OAuth flow first by visiting /');
    }

    console.log('📤 Refreshing access token...');

    const updatedTokens = await doRefreshToken(tokens);
    await writeTokens(updatedTokens);

    console.log('✅ Token refreshed successfully');
    console.log('   New ACCESS_TOKEN:', updatedTokens.access_token);
    console.log('   Expires At:', new Date(updatedTokens.expires_at).toISOString());

    const expiresInSeconds = Math.round((updatedTokens.expires_at - Date.now()) / 1000);
    res.type('text/plain').send(`
Token Refreshed Successfully!
=============================

Access Token:
${updatedTokens.access_token}

Token Type: ${updatedTokens.token_type}
Expires In: ${expiresInSeconds} seconds (${Math.round(expiresInSeconds / 60)} minutes)
Scope: ${updatedTokens.scope}

✅ tokens.json updated

You can now use this token in Postman:
  GET https://api.salla.dev/admin/v2/orders
  Header: Authorization: Bearer ${updatedTokens.access_token}
    `.trim());

  } catch (error) {
    console.error('❌ Error refreshing token:');
    
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
      
      return res.status(error.response.status).type('text/plain').send(`
Error refreshing token: ${error.message}
Status: ${error.response.status}
Details: ${JSON.stringify(error.response.data, null, 2)}

You may need to re-authorize by visiting /
      `.trim());
    } else {
      console.error('   Message:', error.message);
      return res.status(500).type('text/plain').send(`Error: ${error.message}`);
    }
  }
});

// Route 4: Get valid token (auto-refresh if expired)
app.get('/salla/token', async (_req, res) => {
  console.log('🔑 Token request received');

  try {
    // Read current tokens
    const tokens = await readTokens();
    
    if (!tokens) {
      console.error('❌ No tokens found');
      return res.status(400).type('text/plain').send('No tokens found. Please complete OAuth flow first by visiting /');
    }

    // Check if token is expired
    if (isExpired(tokens.expires_at)) {
      console.log('⏰ Token expired, auto-refreshing...');

      if (!tokens.refresh_token) {
        console.error('❌ No refresh token available');
        return res.status(400).type('text/plain').send('Token expired and no refresh token available. Please re-authorize by visiting /');
      }

      const updatedTokens = await doRefreshToken(tokens);
      await writeTokens(updatedTokens);

      console.log('✅ Token auto-refreshed successfully');

      const expiresInSeconds = Math.round((updatedTokens.expires_at - Date.now()) / 1000);
      return res.type('text/plain').send(`
Valid Access Token (Auto-Refreshed)
====================================

Access Token:
${updatedTokens.access_token}

Token Type: ${updatedTokens.token_type}
Expires In: ${expiresInSeconds} seconds (${Math.round(expiresInSeconds / 60)} minutes)
Scope: ${updatedTokens.scope}

✅ tokens.json updated
      `.trim());
    }

    // Token is still valid
    const remainingSeconds = Math.floor((tokens.expires_at - Date.now()) / 1000);
    console.log('✅ Token still valid');
    console.log('   Remaining time:', remainingSeconds, 'seconds');

    res.type('text/plain').send(`
Valid Access Token (Current)
=============================

Access Token:
${tokens.access_token}

Token Type: ${tokens.token_type}
Expires In: ${remainingSeconds} seconds (${Math.round(remainingSeconds / 60)} minutes)
Scope: ${tokens.scope}

✅ Token is still valid, no refresh needed
    `.trim());

  } catch (error) {
    console.error('❌ Error getting token:');
    
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
      
      return res.status(error.response.status).type('text/plain').send(`
Error: ${error.message}
Status: ${error.response.status}
Details: ${JSON.stringify(error.response.data, null, 2)}
      `.trim());
    } else {
      console.error('   Message:', error.message);
      return res.status(500).type('text/plain').send(`Error: ${error.message}`);
    }
  }
});

// ─────────────────────────────────────────────────────────────
// DB-backed token endpoints (new token manager)
// ─────────────────────────────────────────────────────────────

// GET /token/status/:storeId  — show token state without triggering refresh
app.get('/token/status/:storeId', async (req, res) => {
  const { storeId } = req.params;
  const record = await findTokenByStoreId(storeId).catch(() => null);
  if (!record) {
    return res.status(404).json({ error: 'no token found for this storeId' });
  }
  res.json({
    storeId:      record.storeId,
    expiresAt:    record.expiresAt,
    timeRemaining: formatTimeRemaining(record.expiresAt),
    needsRefresh:  needsRefresh(record.expiresAt),
    // never expose the actual token values here
  });
});

// GET /token/refresh/:storeId  — force-fetch a valid token (triggers refresh if needed)
app.get('/token/refresh/:storeId', async (req, res) => {
  const { storeId } = req.params;
  try {
    const token = await getValidSallaToken(storeId);
    res.json({
      storeId,
      status:       'valid',
      access_token: token,
    });
  } catch (err) {
    if (err instanceof TokenNotFoundError) {
      return res.status(404).json({ error: 'token_not_found', message: err.message });
    }
    if (err instanceof TokenRefreshError) {
      return res.status(502).json({ error: 'refresh_failed', detail: err.detail });
    }
    throw err;
  }
});

// File-based auto-refresh: syncs tokens.json AND the DB
// Runs every 30 min; refreshes when token has < 1 day remaining.
const AUTO_REFRESH_INTERVAL_MS      = 30 * 60 * 1000; // check every 30 minutes
const REFRESH_BEFORE_EXPIRY_SECONDS = 24 * 60 * 60;   // refresh when < 1 day left

async function runAutoRefresh() {
  try {
    const tokens = await readTokens();
    if (!tokens?.refresh_token) return;
    if (!expiresWithin(tokens.expires_at, REFRESH_BEFORE_EXPIRY_SECONDS)) return;

    console.log('🔄 Auto-refreshing Salla token (expiring within 24h)...');
    const updated = await doRefreshToken(tokens);
    await writeTokens(updated);

    console.log('✅ Token refreshed (tokens.json — per-tenant DB tokens managed by sallaTokenService)');
  } catch (err) {
    console.error('❌ Auto-refresh failed:', err.message);
  }
}

function startTokenAutoRefresh() {
  setTimeout(() => runAutoRefresh(), 10 * 1000);
  setInterval(runAutoRefresh, AUTO_REFRESH_INTERVAL_MS);
}

// Start server (optional DB; order poller polls Salla and stores orders locally)
async function start() {
  startTokenAutoRefresh();
  startTokenRefreshScheduler(); // proactive DB-backed refresh (< 1 day remaining)

  if (process.env.DATABASE_URL) {
    try {
      await initDatabase();
      console.log('[db] ready');
      await seedAdminFromEnv();
    } catch (err) {
      console.error('[db] init failed:', err.message);
    }
  }

  const server = app.listen(PORT, () => {
    startOrderPoller();

    const line = '─'.repeat(52);
    console.log(`\n┌${line}┐`);
    console.log(`│  Salla Hub                                         │`);
    console.log(`├${line}┤`);
    console.log(`│  Server   http://localhost:${String(PORT).padEnd(24)}│`);
    console.log(`│  Mode     multi-tenant (credentials from DB)       │`);
    console.log(`├${line}┤`);
    console.log(`│  OAuth                                             │`);
    console.log(`│    GET  /                    list all clients       │`);
    console.log(`│    GET  /salla/auth/:slug    start OAuth for client │`);
    console.log(`│    GET  /salla/callback      OAuth callback         │`);
    console.log(`├${line}┤`);
    console.log(`│  Webhooks                                          │`);
    console.log(`│    POST /webhooks/salla/:slug  per-client webhook   │`);
    console.log(`│    POST /webhooks/salla        generic webhook      │`);
    console.log(`├${line}┤`);
    console.log(`│  Admin                                             │`);
    console.log(`│    GET  /admin/clients         list clients         │`);
    console.log(`│    POST /admin/clients         create client        │`);
    console.log(`│    GET  /admin/clients/:id/auth-url  OAuth URL      │`);
    console.log(`├${line}┤`);
    console.log(`│  Orders & Products                                 │`);
    console.log(`│    GET  /orders                list orders          │`);
    console.log(`│    GET  /orders/stats          statistics           │`);
    console.log(`│    GET  /products              list products        │`);
    console.log(`│    GET  /poll-logs             poller history       │`);
    console.log(`└${line}┘\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[server] Port ${PORT} already in use — stop the other process (lsof -i :${PORT}) or set a different PORT`);
      process.exit(1);
    }
    throw err;
  });
}

start().catch((err) => {
  console.error('[server] fatal:', err.message);
  process.exit(1);
});
