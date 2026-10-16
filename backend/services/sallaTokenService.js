/**
 * sallaTokenService.js
 * --------------------
 * Production-ready Salla OAuth token manager.
 *
 * Core contract:
 *   getValidSallaToken(storeId) → string (a guaranteed-fresh access token)
 *
 * Guarantees:
 *  1. Token fetched from DB; returned as-is if still valid.
 *  2. Auto-refresh when < 5 minutes remain before expiry.
 *  3. Refreshed tokens (access + refresh) persisted back to DB.
 *  4. In-process mutex prevents duplicate refresh calls for the same store.
 *  5. Refresh failures throw structured errors so callers can handle them.
 *  6. Secrets (tokens) are never written to logs.
 */

import axios from 'axios';
import {
  findTokenByStoreId,
  upsertToken,
  updateToken,
} from '../db/tokenRepository.js';
import {
  needsRefresh,
  computeExpiresAt,
  formatTimeRemaining,
} from '../helpers/tokenExpiry.js';
import { getClientById } from '../models/client.js';
import prisma from '../config/prisma.js';

// ----------------------------------------------------------------
// Config — env vars are the fallback when no DB client is linked
// ----------------------------------------------------------------
const SALLA_TOKEN_URL = 'https://accounts.salla.sa/oauth2/token';

// ----------------------------------------------------------------
// In-process refresh lock
//
// Maps storeId → Promise<string>
//
// When a refresh is already in flight for a store, subsequent calls
// await the same Promise instead of firing a second HTTP request.
//
// NOTE: This lock is per-process. If you run multiple Node processes
// (PM2 cluster, Kubernetes pods) you need a distributed lock instead
// (e.g. a Postgres advisory lock or a Redis SET NX PX lock).
// ----------------------------------------------------------------
/** @type {Map<string, Promise<string>>} */
const refreshInFlight = new Map();

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

/**
 * Return a valid access token for the given Salla store.
 * Refreshes automatically when the token is about to expire.
 *
 * @param {string} storeId
 * @returns {Promise<string>} A fresh access token
 * @throws {TokenNotFoundError} if no token record exists for the store
 * @throws {TokenRefreshError}  if the refresh HTTP call fails
 */
export async function getValidSallaToken(storeId) {
  if (!storeId) throw new TypeError('storeId is required');

  const record = await findTokenByStoreId(storeId);

  if (!record) {
    throw new TokenNotFoundError(storeId);
  }

  // Token still valid — return immediately
  if (!needsRefresh(record.expiresAt)) {
    log('info', 'Token valid', {
      storeId,
      expiresIn: formatTimeRemaining(record.expiresAt),
    });
    return record.accessToken;
  }

  // Token needs refresh — acquire in-process lock
  log('info', 'Token needs refresh', {
    storeId,
    expiresIn: formatTimeRemaining(record.expiresAt),
  });

  return acquireRefreshLock(storeId, record);
}

/**
 * Save a brand-new token (e.g. after the initial OAuth callback).
 * Creates or replaces the record for this store.
 *
 * @param {{ storeId, accessToken, refreshToken, expiresIn, clientId? }} data
 * @returns {Promise<object>} The persisted token record
 */
export async function saveToken({ storeId, accessToken, refreshToken, expiresIn, clientId }) {
  if (!storeId || !accessToken || !refreshToken || !expiresIn) {
    throw new TypeError('storeId, accessToken, refreshToken, and expiresIn are all required');
  }

  const expiresAt = computeExpiresAt(new Date(), expiresIn);

  const record = await upsertToken({ storeId, clientId: clientId ?? null, accessToken, refreshToken, expiresIn, expiresAt });

  log('info', 'Token saved', { storeId, expiresAt: expiresAt.toISOString() });
  return record;
}

// ----------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------

/**
 * Acquire (or reuse) a per-store refresh lock.
 * Returns the new access token once the refresh completes.
 *
 * @param {string} storeId
 * @param {object} currentRecord - The stale token record from DB
 * @returns {Promise<string>}
 */
async function acquireRefreshLock(storeId, currentRecord) {
  // If a refresh is already in flight for this store, piggyback on it
  if (refreshInFlight.has(storeId)) {
    log('info', 'Refresh already in flight — awaiting', { storeId });
    return refreshInFlight.get(storeId);
  }

  // We are the first caller — start the refresh and register the promise
  const refreshPromise = performRefresh(storeId, currentRecord).finally(() => {
    // Always clean up the lock, whether the refresh succeeded or failed
    refreshInFlight.delete(storeId);
  });

  refreshInFlight.set(storeId, refreshPromise);
  return refreshPromise;
}

/**
 * Call the Salla token endpoint to exchange the refresh token for new credentials.
 * Persists the new tokens to the DB.
 *
 * @param {string} storeId
 * @param {object} currentRecord
 * @returns {Promise<string>} The new access token
 */
async function performRefresh(storeId, currentRecord) {
  // Resolve OAuth credentials — prefer per-client DB record, fall back to env vars
  let clientIdParam = null;
  let clientSecret  = null;

  if (currentRecord.clientId) {
    try {
      const dbClient = await getClientById(currentRecord.clientId);
      if (dbClient) {
        clientIdParam = dbClient.sallaClientId;
        clientSecret  = dbClient.sallaClientSecret;
      }
    } catch (e) {
      log('warn', 'Could not load client credentials from DB — falling back to env', { storeId, message: e.message });
    }
  }

  if (!clientIdParam || !clientSecret) {
    throw new Error(
      'No Salla OAuth credentials found — link this store to a client in the DB'
    );
  }

  log('info', 'Calling Salla refresh endpoint', { storeId });

  let response;
  try {
    response = await axios.post(
      SALLA_TOKEN_URL,
      new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     clientIdParam,
        client_secret: clientSecret,
        refresh_token: currentRecord.refreshToken,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10_000,
      }
    );
  } catch (err) {
    // Salla returned a non-2xx status
    const status  = err.response?.status;
    const message = err.response?.data?.error_description ?? err.message;

    log('error', 'Salla refresh request failed', { storeId, status, message });
    throw new TokenRefreshError(storeId, status, message);
  }

  // Destructure response — Salla may or may not rotate the refresh token
  const {
    access_token,
    refresh_token: newRefreshToken,
    expires_in,
  } = response.data;

  if (!access_token) {
    throw new TokenRefreshError(storeId, null, 'Salla response missing access_token');
  }

  const expiresAt = computeExpiresAt(new Date(), expires_in ?? 3600);

  // Persist — keep old refresh token if Salla didn't issue a new one
  await updateToken({
    storeId,
    accessToken:  access_token,
    refreshToken: newRefreshToken ?? currentRecord.refreshToken,
    expiresIn:    expires_in ?? 3600,
    expiresAt,
  });

  log('info', 'Token refreshed and persisted', {
    storeId,
    newExpiresAt: expiresAt.toISOString(),
    // Never log the actual token values
  });

  return access_token;
}

// ----------------------------------------------------------------
// Structured logger
// ----------------------------------------------------------------

/**
 * Minimal structured logger.
 * Replace with your preferred logging library (winston, pino, etc.)
 * Never include token values in log output.
 *
 * @param {'info'|'warn'|'error'} level
 * @param {string} message
 * @param {object} [meta]
 */
function log(level, message, meta = {}) {
  // Safety guard: if someone accidentally passes a token, mask it
  const safeMeta = maskSecrets(meta);
  const entry = {
    ts:      new Date().toISOString(),
    level,
    service: 'sallaTokenService',
    message,
    ...safeMeta,
  };
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry));
}

/** Replace values whose keys hint at secrets with '***'. */
function maskSecrets(obj) {
  const SENSITIVE_KEYS = /token|secret|password|key|credential/i;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) =>
      SENSITIVE_KEYS.test(k) ? [k, '***'] : [k, v]
    )
  );
}

// ----------------------------------------------------------------
// Custom error types
// ----------------------------------------------------------------

export class TokenNotFoundError extends Error {
  constructor(storeId) {
    super(`No token record found for storeId: ${storeId}`);
    this.name    = 'TokenNotFoundError';
    this.storeId = storeId;
  }
}

export class TokenRefreshError extends Error {
  constructor(storeId, httpStatus, detail) {
    super(`Token refresh failed for storeId: ${storeId} — ${detail}`);
    this.name       = 'TokenRefreshError';
    this.storeId    = storeId;
    this.httpStatus = httpStatus;
    this.detail     = detail;
  }
}

// ----------------------------------------------------------------
// Proactive token refresh scheduler
//
// Runs on startup and every SCHEDULER_INTERVAL_MS.
// Refreshes the token when less than PROACTIVE_THRESHOLD_SECONDS remain
// so the poller never hits an expired token in production.
// ----------------------------------------------------------------

const PROACTIVE_THRESHOLD_SECONDS = 24 * 60 * 60; // refresh when < 1 day remaining
const SCHEDULER_INTERVAL_MS       = 30 * 60 * 1000; // check every 30 minutes

/**
 * Start the background token refresh scheduler.
 * Every SCHEDULER_INTERVAL_MS it loads all stores from DB and proactively
 * refreshes any token expiring within PROACTIVE_THRESHOLD_SECONDS.
 */
export function startTokenRefreshScheduler() {
  const run = () => proactiveRefreshAll();
  run(); // immediate check on startup
  setInterval(run, SCHEDULER_INTERVAL_MS);
  log('info', `Token scheduler started — checking all stores every ${SCHEDULER_INTERVAL_MS / 60000}min`);
}

async function proactiveRefreshAll() {
  let records;
  try {
    records = await prisma.sallaToken.findMany();
  } catch (err) {
    log('error', 'Scheduler: could not load tokens from DB', { message: err.message });
    return;
  }

  if (!records.length) {
    log('info', 'Scheduler: no token records found — nothing to refresh');
    return;
  }

  for (const record of records) {
    const msUntilExpiry = new Date(record.expiresAt).getTime() - Date.now();
    if (msUntilExpiry >= PROACTIVE_THRESHOLD_SECONDS * 1000) {
      log('info', 'Scheduler: token still fresh', {
        storeId: record.storeId,
        expiresIn: formatTimeRemaining(record.expiresAt),
      });
      continue;
    }
    log('info', 'Scheduler: token expiring soon — refreshing proactively', {
      storeId: record.storeId,
      expiresIn: formatTimeRemaining(record.expiresAt),
    });
    try {
      await acquireRefreshLock(record.storeId, record);
      log('info', 'Scheduler: proactive refresh complete', { storeId: record.storeId });
    } catch (err) {
      log('error', 'Scheduler: proactive refresh failed', { storeId: record.storeId, message: err.message });
    }
  }
}
