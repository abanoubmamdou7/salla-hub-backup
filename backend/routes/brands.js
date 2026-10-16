import express from 'express';
import { listBrands, createBrand, updateBrand, deleteBrand } from '../models/brandMapping.js';

const router = express.Router();

// GET /brands?clientId=1 — list all, or client-specific + global
router.get('/', async (req, res) => {
  try {
    const clientId = req.query.clientId ? parseInt(req.query.clientId, 10) : null;
    const brands = await listBrands(clientId);
    res.json({ ok: true, data: brands });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /brands — add new
// Body: { keyword, brandCode, description?, credentialMode?, clientId? }
router.post('/', async (req, res) => {
  const { keyword, brandCode, description, credentialMode, clientId } = req.body ?? {};
  if (!keyword || !brandCode) {
    return res.status(400).json({ ok: false, error: 'keyword and brandCode are required' });
  }
  try {
    const brand = await createBrand({
      keyword, brandCode, description,
      credentialMode: credentialMode || null,
      clientId: clientId ? parseInt(clientId, 10) : null,
    });
    res.status(201).json({ ok: true, data: brand });
  } catch (err) {
    const isDuplicate = err.code === '23505';
    res.status(isDuplicate ? 409 : 500).json({
      ok: false,
      error: isDuplicate ? `keyword "${keyword}" already exists for this client` : err.message,
    });
  }
});

// PUT /brands/:id — update
router.put('/:id', async (req, res) => {
  const { keyword, brandCode, description, credentialMode } = req.body ?? {};
  if (!keyword || !brandCode) {
    return res.status(400).json({ ok: false, error: 'keyword and brandCode are required' });
  }
  try {
    const brand = await updateBrand(Number(req.params.id), { keyword, brandCode, description, credentialMode: credentialMode || null });
    if (!brand) return res.status(404).json({ ok: false, error: 'Brand not found' });
    res.json({ ok: true, data: brand });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /brands/:id — remove
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteBrand(Number(req.params.id));
    if (!deleted) return res.status(404).json({ ok: false, error: 'Brand not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
