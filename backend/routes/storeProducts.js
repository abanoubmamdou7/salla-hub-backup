/**
 * storeProducts.js
 * ----------------
 * Example Express route demonstrating getValidSallaToken() usage.
 *
 * GET /stores/:storeId/products
 *   → fetches products from Salla API using a guaranteed-fresh token.
 *
 * This pattern applies to any Salla API call — just swap the endpoint.
 */

import { Router } from 'express';
import axios from 'axios';
import {
  getValidSallaToken,
  TokenNotFoundError,
  TokenRefreshError,
} from '../services/sallaTokenService.js';

const router = Router();

const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';

// ----------------------------------------------------------------
// GET /stores/:storeId/products
// ----------------------------------------------------------------
router.get('/:storeId/products', async (req, res) => {
  const { storeId } = req.params;

  // --- 1. Obtain a valid token -----------------------------------
  let accessToken;
  try {
    accessToken = await getValidSallaToken(storeId);
  } catch (err) {
    if (err instanceof TokenNotFoundError) {
      return res.status(404).json({
        error: 'store_not_found',
        message: `No OAuth token found for store ${storeId}. Complete the OAuth flow first.`,
      });
    }
    if (err instanceof TokenRefreshError) {
      return res.status(502).json({
        error: 'token_refresh_failed',
        message: 'Could not refresh Salla access token. The store owner may need to re-authorize.',
        detail: err.detail,
      });
    }
    // Unexpected error — let the global error handler deal with it
    throw err;
  }

  // --- 2. Call Salla API ----------------------------------------
  const page     = parseInt(req.query.page     ?? '1',  10);
  const per_page = parseInt(req.query.per_page ?? '20', 10);

  let sallaResponse;
  try {
    sallaResponse = await axios.get(`${SALLA_API_BASE}/products`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params:  { page, per_page },
      timeout: 15_000,
    });
  } catch (err) {
    const status  = err.response?.status ?? 502;
    const message = err.response?.data?.error?.message ?? err.message;
    return res.status(status).json({ error: 'salla_api_error', message });
  }

  // --- 3. Return the data ---------------------------------------
  return res.json({
    storeId,
    data:       sallaResponse.data?.data       ?? [],
    pagination: sallaResponse.data?.pagination ?? {},
  });
});

export default router;
