import express from 'express';
import { fetchProduct, fetchProducts, fetchAllProducts } from '../services/sallaApi.js';

const router = express.Router();

// GET /products?page=1&per_page=20&keyword=&status=
router.get('/', async (req, res) => {
  try {
    const page     = parseInt(req.query.page     || '1',  10);
    const per_page = Math.min(parseInt(req.query.per_page || '20', 10), 100);
    const keyword  = req.query.keyword  || undefined;
    const status   = req.query.status   || undefined;

    const { products, pagination } = await fetchProducts({ page, per_page, keyword, status });
    res.json({ products, pagination });
  } catch (err) {
    console.error('[products] List error:', err.message);
    res.status(err.response?.status ?? 500).json({ error: err.message });
  }
});

// GET /products/no-sku — products where SKU is missing or empty
router.get('/no-sku', async (req, res) => {
  try {
    const all = await fetchAllProducts({
      status:  req.query.status  || undefined,
      keyword: req.query.keyword || undefined,
    });
    const noSku = all.filter(p => !p.sku || p.sku.trim() === '');
    res.json({ count: noSku.length, products: noSku });
  } catch (err) {
    console.error('[products] no-sku error:', err.message);
    res.status(err.response?.status ?? 500).json({ error: err.message });
  }
});

// GET /products/:id
router.get('/:id', async (req, res) => {
  try {
    const product = await fetchProduct(req.params.id);
    res.json({ product });
  } catch (err) {
    console.error('[products] Fetch error:', err.message);
    res.status(err.response?.status ?? 500).json({ error: err.message });
  }
});

export default router;
