import crypto from 'crypto';

/**
 * Verify Salla webhook signature (HMAC-SHA256).
 * @param {string} rawBody - Raw request body (string or Buffer)
 * @param {string} signature - Value from X-Salla-Signature header
 * @param {string} secret - Webhook secret from env
 * @returns {boolean}
 */
export function verifySallaWebhookSignature(rawBody, signature, secret) {
  if (!secret || !signature) {
    return false;
  }
  const body = typeof rawBody === 'string' ? rawBody : (rawBody?.toString?.() ?? '');
  const computed = crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(computed, 'hex'));
  } catch {
    return false;
  }
  
}
