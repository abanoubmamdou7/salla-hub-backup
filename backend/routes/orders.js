import { readFileSync } from 'fs';
import express from 'express';
import { getOrderBySallaId, listOrders, countOrders, getStats, upsertOrder, updateOrderStatus, releaseOrderClaim } from '../models/order.js';
import { fetchOrders, fetchOrderWithOptions } from '../services/sallaApi.js';
import { processOrder, buildOrderBody } from '../services/supplierHubService.js';

const router = express.Router();

function extractOrderSummary(sallaData) {
  if (!sallaData || typeof sallaData !== 'object') return {};
  const order = sallaData?.data ?? sallaData;
  const customer = order?.customer ?? order?.buyer ?? {};
  const orderNumber =
    order?.order_number ?? order?.reference_id ?? order?.number ?? (order?.id != null ? String(order.id) : null);
  const customerName = customer?.full_name ?? customer?.name ?? null;
  const total =
    order?.totals?.total?.amount ?? order?.total?.amount ?? order?.total ?? null;
  return { order_number: orderNumber, customer_name: customerName, total };
}

/** Get order date string (YYYY-MM-DD) from Salla API order object. */
function getOrderDateKey(order) {
  const raw = order?.date?.date ?? order?.created_at?.date ?? order?.created_at ?? null;
  if (!raw) return null;
  try {
    const d = new Date(String(raw).replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

router.get('/', async (req, res) => {
  try {
    const status  = req.query.status || null;
    const search  = (req.query.search || '').trim() || null;
    const limit   = Math.min(parseInt(req.query.limit  || '50', 10), 100);
    const offset  = parseInt(req.query.offset || '0', 10);
    const summary = req.query.summary === 'true';
    const [rows, total] = await Promise.all([
      listOrders({ status, search, limit, offset, includeSummary: summary }),
      countOrders({ status, search }),
    ]);
    const orders = summary
      ? rows.map((row) => {
          const { salla_data, ...rest } = row;
          return { ...rest, ...extractOrderSummary(salla_data) };
        })
      : rows;
    res.json({ orders, total, limit, offset });
  } catch (err) {
    console.error('[orders] List error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /orders/sync ────────────────────────────────────────────────────────
// Fetch orders from Salla API and persist each one locally (no external forward).
//
// Query params:
//   page      (default 1)
//   per_page  (default 20, max 50)
//   all_pages (default false) — iterate all pages automatically
//   status    (optional) filter by Salla order status slug
router.post('/sync', async (req, res) => {
  const page      = parseInt(req.query.page || req.body?.page || '1', 10);
  const perPage   = Math.min(parseInt(req.query.per_page || req.body?.per_page || '20', 10), 50);
  const allPages  = (req.query.all_pages ?? req.body?.all_pages) === 'true' || (req.query.all_pages ?? req.body?.all_pages) === true;
  const statusFilter = req.query.status || req.body?.status || undefined;

  console.log(`[sync] Starting sync — page=${page}, per_page=${perPage}, all_pages=${allPages}${statusFilter ? `, status=${statusFilter}` : ''}`);

  const summary = { total: 0, stored: 0, skipped: 0, results: [] };

  async function syncPage(p) {
    const { orders, pagination } = await fetchOrders({ page: p, per_page: perPage, status: statusFilter });
    console.log(`[sync] Page ${p}/${pagination.totalPages ?? '?'} — ${orders.length} orders`);

    for (const order of orders) {
      const orderId = String(order.id);
      summary.total++;
      try {
        await upsertOrder(orderId, order, 'pending');
        await updateOrderStatus(orderId, 'sent');
        summary.stored++;
        summary.results.push({ order_id: orderId, status: 'stored' });
      } catch (err) {
        console.warn(`[sync] ⚠️  Order ${orderId} skipped — ${err.message}`);
        summary.skipped++;
        summary.results.push({ order_id: orderId, status: 'skipped', reason: err.message });
      }
    }

    return pagination;
  }

  try {
    const pagination = await syncPage(page);

    if (allPages && pagination.totalPages > page) {
      for (let p = page + 1; p <= pagination.totalPages; p++) {
        await syncPage(p);
      }
    }

    console.log(`[sync] Done — total=${summary.total} stored=${summary.stored} skipped=${summary.skipped}`);
    res.json({
      ok: true,
      summary: { total: summary.total, stored: summary.stored, skipped: summary.skipped },
      results: summary.results,
    });
  } catch (err) {
    console.error('[sync] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message, partial: summary });
  }
});

// ─── GET /orders/salla-average-per-day (TEST) ─────────────────────────────────
// Fetches orders from Salla API (paginated), groups by date, returns average per day.
// Query: days (default 30), max_pages (default 10, cap to avoid hammering Salla).
router.get('/salla-average-per-day', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days || '30', 10), 1), 365);
    const maxPages = Math.min(Math.max(parseInt(req.query.max_pages || '10', 10), 1), 50);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const perPage = 60;
    const byDate = {};
    let totalOrders = 0;
    let pagesFetched = 0;

    for (let page = 1; page <= maxPages; page++) {
      const { orders, pagination } = await fetchOrders({ page, per_page: perPage });
      pagesFetched++;
      if (!orders?.length) break;

      for (const order of orders) {
        const dateKey = getOrderDateKey(order);
        if (!dateKey) continue;
        const orderTime = new Date(dateKey).getTime();
        if (orderTime < cutoff) continue;
        byDate[dateKey] = (byDate[dateKey] || 0) + 1;
        totalOrders++;
      }

      if (pagination.totalPages != null && page >= pagination.totalPages) break;
    }

    const dailyBreakdown = Object.entries(byDate)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, count]) => ({ date, count }));
    const averagePerDay = days > 0 ? Math.round((totalOrders / days) * 100) / 100 : 0;

    res.json({
      test: true,
      days_in_period: days,
      max_pages_used: maxPages,
      pages_fetched: pagesFetched,
      total_orders_in_sample: totalOrders,
      average_orders_per_day: averagePerDay,
      daily_breakdown: dailyBreakdown,
    });
  } catch (err) {
    console.error('[orders] salla-average-per-day error:', err.message);
    res.status(500).json({ error: err.message, test: true });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json({
      total: parseInt(stats.total, 10),
      pending: parseInt(stats.pending, 10),
      sent: parseInt(stats.sent, 10),
      failed: parseInt(stats.failed, 10),
    });
  } catch (err) {
    console.error('[orders] Stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /orders/qar — returns QAR orders JSON
router.get('/qar', (req, res) => {
  try {
    const data = JSON.parse(readFileSync('qar-orders.json', 'utf8'));
    res.json(data);
  } catch {
    res.status(404).json({ error: 'No QAR orders report found. Run: node scripts/qar-orders.js' });
  }
});

// GET /orders/qar/report — HTML report of QAR orders
router.get('/qar/report', (_req, res) => {
  let data;
  try {
    data = JSON.parse(readFileSync('qar-orders.json', 'utf8'));
  } catch {
    return res.status(404).send('<h2>No report found. Run: <code>node scripts/qar-orders.js</code></h2>');
  }

  const orders = data.orders ?? [];
  const totalQAR = orders.reduce((s, o) => s + (o.total_amount ?? 0), 0);

  const rows = orders.map((o, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${o.reference_id ?? o.id}</strong></td>
      <td>${(o.date ?? '').slice(0, 10)}</td>
      <td>${o.customer ?? '—'}</td>
      <td dir="ltr">${o.customer_phone ? o.mobile_code + ' ' + o.customer_phone : '—'}</td>
      <td class="num">${Number(o.total_amount ?? 0).toFixed(2)} QAR</td>
      <td>${o.payment_method ?? '—'}</td>
      <td><span class="badge ${o.status_slug ?? ''}">${o.status ?? '—'}</span></td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير طلبات QAR - 2026</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f0f2f5; color: #1a1a2e; }
    header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 28px 40px; }
    header h1 { font-size: 1.6rem; font-weight: 700; }
    header p  { opacity: .7; margin-top: 4px; font-size: .9rem; }
    .stats { display: flex; gap: 16px; padding: 24px 40px; flex-wrap: wrap; }
    .card { background: white; border-radius: 12px; padding: 20px 28px; flex: 1; min-width: 180px;
            box-shadow: 0 2px 8px rgba(0,0,0,.06); }
    .card .label { font-size: .8rem; color: #888; margin-bottom: 6px; }
    .card .value { font-size: 1.8rem; font-weight: 700; color: #1a1a2e; }
    .card .value.blue  { color: #2563eb; }
    .card .value.green { color: #16a34a; }
    .card .value.purple{ color: #7c3aed; }
    .table-wrap { margin: 0 40px 40px; background: white; border-radius: 12px;
                  box-shadow: 0 2px 8px rgba(0,0,0,.06); overflow: hidden; }
    .table-wrap .toolbar { padding: 16px 20px; border-bottom: 1px solid #f0f0f0; display: flex;
                           justify-content: space-between; align-items: center; }
    .toolbar input { border: 1px solid #e0e0e0; border-radius: 8px; padding: 8px 14px;
                     font-size: .9rem; width: 260px; outline: none; }
    .toolbar input:focus { border-color: #2563eb; }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; }
    th { background: #f8fafc; padding: 13px 16px; text-align: right; font-weight: 600;
         color: #555; border-bottom: 2px solid #e8ecf0; white-space: nowrap; }
    td { padding: 12px 16px; border-bottom: 1px solid #f0f2f5; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f8fafc; }
    .num { font-weight: 600; color: #2563eb; direction: ltr; text-align: left; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: .8rem; font-weight: 600; }
    .badge.completed  { background: #dcfce7; color: #16a34a; }
    .badge.canceled   { background: #fee2e2; color: #dc2626; }
    .badge.pending    { background: #fef9c3; color: #ca8a04; }
    .badge            { background: #e0e7ff; color: #3730a3; }
    footer { text-align: center; padding: 20px; color: #aaa; font-size: .8rem; }
    @media(max-width:700px){ .stats{padding:16px;} .table-wrap{margin:0 12px 24px;} header{padding:20px;} }
  </style>
</head>
<body>
  <header>
    <h1>🇶🇦 تقرير طلبات QAR — 2026</h1>
    <p>تم الإنشاء: ${new Date(data.generated_at).toLocaleString('ar-SA')} &nbsp;|&nbsp; المصدر: Salla</p>
  </header>

  <div class="stats">
    <div class="card">
      <div class="label">إجمالي الطلبات</div>
      <div class="value blue">${orders.length}</div>
    </div>
    <div class="card">
      <div class="label">إجمالي المبيعات (QAR)</div>
      <div class="value green">${totalQAR.toFixed(2)}</div>
    </div>
    <div class="card">
      <div class="label">طريقة الدفع الأكثر استخداماً</div>
      <div class="value purple">${mostCommon(orders.map(o => o.payment_method))}</div>
    </div>
  </div>

  <div class="table-wrap">
    <div class="toolbar">
      <strong>قائمة الطلبات</strong>
      <input type="text" id="search" placeholder="ابحث بالاسم أو رقم الطلب..." oninput="filter(this.value)">
    </div>
    <table id="tbl">
      <thead>
        <tr>
          <th>#</th>
          <th>رقم الطلب</th>
          <th>التاريخ</th>
          <th>العميل</th>
          <th>الهاتف</th>
          <th>المبلغ</th>
          <th>طريقة الدفع</th>
          <th>الحالة</th>
        </tr>
      </thead>
      <tbody id="tbody">${rows}</tbody>
    </table>
  </div>

  <footer>Purple Cards — QAR Orders Report 2026</footer>

  <script>
    function filter(q) {
      q = q.toLowerCase();
      document.querySelectorAll('#tbody tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;

  // helper: most common value in array
  function mostCommon(arr) {
    if (!arr.length) return '—';
    const freq = {};
    arr.forEach(v => { freq[v] = (freq[v] ?? 0) + 1; });
    return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// POST /orders/hub/test
// Send a fake order to SupplierHub — no real Salla order needed.
// Body: { hubApiKey, brandCode, playerId, coins, quantity, os, orderNumber }
router.post('/hub/test', async (req, res) => {
  const {
    hubApiKey,
    clientId,
    brandCode   = 'MSA',
    playerId    = '1717',
    coins       = 1,
    quantity    = 1,
    os          = 'Android',
    orderNumber = `TEST-${Date.now()}`,
  } = req.body ?? {};

  const tenantCreds = (hubApiKey || clientId) ? { hubApiKey, clientId } : null;

  try {
    const { submitOrderBody } = await import('../services/supplierHubService.js');
    const orderBody = [{
      brandCode,
      orderNumber,
      orderDateTime: new Date().toISOString(),
      playerId,
      OS:       os,
      Coins:    coins,
      quantity,
      sku:      `${brandCode}_${coins}`,
      credentialMode: 'CLIENT',
    }];
    console.log('[hub/test] Order body:', JSON.stringify(orderBody, null, 2));
    const result = await submitOrderBody(orderBody, tenantCreds);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[hub/test] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// keep old path as alias
router.post('/masa/test', (_req, res) => res.redirect(307, '/orders/hub/test'));

// POST /orders/:salla_order_id/masa
// Full Masa top-up flow: fetch order → encrypt → submit → decrypt
router.post('/:salla_order_id/masa', async (req, res) => {
  try {
    let order = await fetchOrderWithOptions(req.params.salla_order_id, req.query.storeId);

    // Salla REST API never returns items — fall back to DB data (stored from webhook payload)
    if (!order.items?.length) {
      const dbRow = await getOrderBySallaId(req.params.salla_order_id);
      const dbData = dbRow?.salla_data;
      if (dbData?.items?.length) {
        console.log(`[orders] Using DB items for order ${req.params.salla_order_id}`);
        order = { ...order, ...dbData };
      }
    }

    const result = await processOrder(order);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[orders] Masa error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /orders/:salla_order_id/masa/preview
// Returns the Masa body that would be sent, without actually submitting
router.get('/:salla_order_id/masa/preview', async (req, res) => {
  try {
    const order = await fetchOrderWithOptions(req.params.salla_order_id, req.query.storeId);
    res.json({ ok: true, orderBody: await buildOrderBody(order) });
  } catch (err) {
    console.error('[orders] Masa preview error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /orders/:salla_order_id/live
// Fetches order details live from Salla API, including item options (e.g. playerId).
// playerId is exposed at the top level as `data.playerId` for convenience.
router.get('/:salla_order_id/live', async (req, res) => {
  try {
    const order = await fetchOrderWithOptions(req.params.salla_order_id, req.query.storeId);
    res.json({ ok: true, data: order });
  } catch (err) {
    console.error('[orders] Live fetch error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /orders/:salla_order_id/lock — release order_locks so poller retries it
router.delete('/:salla_order_id/lock', async (req, res) => {
  try {
    await releaseOrderClaim(req.params.salla_order_id);
    await updateOrderStatus(req.params.salla_order_id, 'pending');
    res.json({ ok: true, message: `Order ${req.params.salla_order_id} unlocked — poller will retry` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /orders/:salla_order_id — read from local DB
router.get('/:salla_order_id', async (req, res) => {
  try {
    const order = await getOrderBySallaId(req.params.salla_order_id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  } catch (err) {
    console.error('[orders] Get error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
