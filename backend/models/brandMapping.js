import { pool } from '../config/database.js';

export async function listBrands(clientId = null) {
  const { rows } = clientId != null
    ? await pool.query(
        'SELECT * FROM brand_mappings WHERE client_id = $1 OR client_id IS NULL ORDER BY client_id NULLS LAST, id',
        [clientId]
      )
    : await pool.query('SELECT * FROM brand_mappings ORDER BY client_id NULLS LAST, id');
  return rows;
}

export async function createBrand({ keyword, brandCode, description, credentialMode, clientId = null }) {
  const { rows } = await pool.query(
    `INSERT INTO brand_mappings (keyword, brand_code, description, credential_mode, client_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [keyword, brandCode, description ?? null, credentialMode ?? null, clientId ?? null]
  );
  return rows[0];
}

export async function updateBrand(id, { keyword, brandCode, description, credentialMode }) {
  const { rows } = await pool.query(
    `UPDATE brand_mappings
     SET keyword=$1, brand_code=$2, description=$3, credential_mode=$4, updated_at=NOW()
     WHERE id=$5 RETURNING *`,
    [keyword, brandCode, description ?? null, credentialMode ?? null, id]
  );
  return rows[0] ?? null;
}

export async function deleteBrand(id) {
  const { rowCount } = await pool.query('DELETE FROM brand_mappings WHERE id=$1', [id]);
  return rowCount > 0;
}

function normalizeArabic(s = '') {
  return s
    .replace(/[آأإ]/g, 'ا')
    .replace(/[ً-ٟـ]/g, '')
    .toLowerCase();
}

/**
 * Two-pass lookup:
 *  1. Client-specific mappings (client_id = clientId)
 *  2. Global mappings (client_id IS NULL)
 */
export async function resolveBrand(productName, clientId = null) {
  const normalized = normalizeArabic(productName);

  // Pass 1 — client-specific
  if (clientId != null) {
    const { rows } = await pool.query(
      'SELECT keyword, brand_code, credential_mode FROM brand_mappings WHERE client_id = $1',
      [clientId]
    );
    for (const row of rows) {
      if (normalized.includes(normalizeArabic(row.keyword ?? ''))) {
        return { brandCode: row.brand_code, credentialMode: row.credential_mode ?? null };
      }
    }
  }

  // Pass 2 — global fallback
  const { rows } = await pool.query(
    'SELECT keyword, brand_code, credential_mode FROM brand_mappings WHERE client_id IS NULL'
  );
  for (const row of rows) {
    if (normalized.includes(normalizeArabic(row.keyword ?? ''))) {
      return { brandCode: row.brand_code, credentialMode: row.credential_mode ?? null };
    }
  }

  return null;
}

export async function resolveBrandCode(productName, clientId = null) {
  const result = await resolveBrand(productName, clientId);
  return result?.brandCode ?? null;
}
