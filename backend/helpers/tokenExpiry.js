/**
 * tokenExpiry.js
 * --------------
 * Pure utility helpers for token expiry checks.
 * No I/O, no side-effects — easy to unit-test in isolation.
 */

/** Tokens refreshed when less than this many seconds remain. */
export const REFRESH_THRESHOLD_SECONDS = 5 * 60; // 5 minutes

/**
 * Compute the absolute expiry timestamp from the moment a token was issued.
 *
 * @param {Date|string|number} issuedAt  - When the token was issued
 * @param {number}             expiresIn - Token lifetime in seconds (e.g. 3600)
 * @returns {Date}
 */
export function computeExpiresAt(issuedAt, expiresIn) {
  const base = new Date(issuedAt).getTime();
  return new Date(base + expiresIn * 1000);
}

/**
 * Return true if the token should be refreshed now.
 *
 * A token is considered stale when the time remaining until expiry
 * drops below REFRESH_THRESHOLD_SECONDS.
 *
 * @param {Date|string|number} expiresAt - Absolute expiry timestamp
 * @returns {boolean}
 */
export function needsRefresh(expiresAt) {
  const msUntilExpiry = new Date(expiresAt).getTime() - Date.now();
  return msUntilExpiry < REFRESH_THRESHOLD_SECONDS * 1000;
}

/**
 * Human-readable time remaining (for logging only — never put tokens here).
 *
 * @param {Date|string|number} expiresAt
 * @returns {string}  e.g. "54m 12s" or "EXPIRED"
 */
export function formatTimeRemaining(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'EXPIRED';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
