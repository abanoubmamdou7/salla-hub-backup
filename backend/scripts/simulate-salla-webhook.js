#!/usr/bin/env node
/**
 * Simulate a Salla order webhook (signed) and POST to your hub.
 * Use this to test: Salla-like payload + signature → hub webhook (order stored locally).
 *
 * Usage:
 *   node scripts/simulate-salla-webhook.js [base_url]
 *
 * Examples:
 *   node scripts/simulate-salla-webhook.js
 *   node scripts/simulate-salla-webhook.js https://conferval-unsmacked-tamika.ngrok-free.dev
 *
 */

import crypto from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually so we can run from project root
try {
  const envPath = resolve(__dirname, '..', '.env');
  const env = readFileSync(envPath, 'utf8');
  env.split('\n').forEach((line) => {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
} catch {
  // .env optional for base_url only
}

const baseUrl = process.argv[2] || 'http://localhost:3000';
const secret = '';

const payload = {
  event: 'order.created',
  created_at: new Date().toISOString(),
  merchant: 'sallaordersbot',
  store_id: 'sim-store-001',
  data: {
    id: String(Date.now()),
    reference_id: `SIM-${Date.now()}`,
    status: { id: 1, name: 'قيد الانتظار', slug: 'pending' },
    created_at: new Date().toISOString(),
    total: { amount: 150, currency: 'SAR' },
    customer: {
      id: 99999,
      name: 'عميل تجريبي',
      email: 'sim@test.com',
      mobile: '0550000000',
      mobile_code: '+966',
    },
    items: [{ name: '1,000 - منتج تجريبي', quantity: 1, price: 150 }],
  },
};

const body = JSON.stringify(payload);
const signature = secret
  ? crypto.createHmac('sha256', secret).update(body).digest('hex')
  : '';

const url = `${baseUrl.replace(/\/$/, '')}/webhooks/salla`;
const headers = {
  'Content-Type': 'application/json',
  'X-Salla-Event': 'order.created',
  ...(signature ? { 'X-Salla-Signature': signature } : {}),
};

console.log('POST', url);
console.log('Sending without signature (webhook secret is per-client in DB).');

const res = await fetch(url, {
  method: 'POST',
  headers,
  body,
});

const text = await res.text();
console.log('Status:', res.status);
console.log('Body:', text);
process.exit(res.ok ? 0 : 1);
