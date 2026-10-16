/**
 * scripts/seedToken.js
 * --------------------
 * One-time script to save the initial Salla OAuth tokens into the DB.
 * Run this right after completing the OAuth flow.
 *
 * Usage:
 *   node scripts/seedToken.js
 */

import dotenv from 'dotenv';
dotenv.config();

import { initDatabase } from '../config/database.js';
import { saveToken } from '../services/sallaTokenService.js';

const TOKEN = {
  storeId:      '563253103',
  accessToken:  'ory_at_plF6xUNU7T4p0QuZlvZwX_PhZbWTbuJyCX1ndGT1Mec.2TDwrIw6PEopfQQzSMdEl706QweX_EZWl9vV-YjO_UY',
  refreshToken: 'ory_rt_5NJJs-FwIJy8_xDS0aFPODXSsugBqDFq_OvnB3Orxlo.SF9OwhORWZM1o2TIam35GalOyFghqa6wp_Nl33ZiF_8',
  expiresIn:    1209599,   // seconds — as returned by Salla
};

async function main() {
  await initDatabase();   // ensure salla_tokens table exists
  const record = await saveToken(TOKEN);
  console.log('Token saved successfully:', {
    id:        record.id,
    storeId:   record.storeId,
    expiresAt: record.expiresAt,
  });
  process.exit(0);
}

main().catch(err => {
  console.error('Failed to seed token:', err.message);
  process.exit(1);
});
