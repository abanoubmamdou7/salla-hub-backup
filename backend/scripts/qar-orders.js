/**
 * Scans all Salla orders for QAR currency and saves results to qar-orders.json + qar-orders.xlsx
 * Run: node scripts/qar-orders.js
 */

import { fetchOrders } from '../services/sallaApi.js';
import { writeFileSync } from 'fs';
import xlsx from 'xlsx';

const OUTPUT_JSON  = 'qar-orders.json';
const OUTPUT_EXCEL = 'qar-orders.xlsx';

async function run() {
  const qarOrders = [];
  let page = 1;
  let totalPages = 1;
  let scanned = 0;

  console.log('Scanning all orders for QAR currency...\n');

  do {
    const { orders, pagination } = await fetchOrders({ page, per_page: 100 });
    totalPages = pagination.totalPages ?? pagination.last_page ?? 1;
    scanned += orders.length;

    let hasAny2026 = false;
    for (const order of orders) {
      const raw = order?.date?.date ?? order?.created_at?.date ?? order?.created_at ?? null;
      const year = raw ? new Date(String(raw).replace(' ', 'T')).getFullYear() : null;
      if (year !== 2026) continue;
      hasAny2026 = true;

      const currency = order?.total?.currency ?? order?.exchange_rate?.exchange_currency;
      if (currency === 'QAR') {
        const c = order?.customer ?? {};
        qarOrders.push({
          id:                order.id,
          reference_id:      order.reference_id,
          date:              order?.date?.date ?? order?.created_at,
          // order
          total_amount:      order?.total?.amount,
          total_sar:         order?.payment_actions?.refund_action?.paid_amount?.amount ?? null,
          currency,
          exchange_rate:     order?.exchange_rate?.rate ?? null,
          payment_method:    order?.payment_method,
          source:            order?.source ?? null,
          status:            order?.status?.name ?? order?.status,
          status_slug:       order?.status?.slug ?? null,
          // customer
          customer_name:     c.full_name ?? c.name ?? null,
          customer_email:    c.email ?? null,
          customer_phone:    c.mobile ?? null,
          mobile_code:       c.mobile_code ?? null,
          customer_city:     c.city ?? null,
          customer_country:  c.country ?? null,
          customer_country_code: c.country_code ?? null,
          // items
          items: (order?.items ?? []).map(it => ({ name: it.name, quantity: it.quantity ?? 1 })),
        });
      }
    }

    process.stdout.write(`\rPage ${page}/${totalPages} — scanned ${scanned} orders — found ${qarOrders.length} QAR`);

    // Orders are newest first — stop once we're past 2026
    if (!hasAny2026 && page > 1) {
      console.log('\n[early stop] No more 2026 orders.');
      break;
    }
    page++;
  } while (page <= totalPages);

  console.log('\n\nDone!\n');
  console.log(`Total scanned : ${scanned}`);
  console.log(`QAR orders    : ${qarOrders.length}`);

  // Save JSON
  const output = { generated_at: new Date().toISOString(), count: qarOrders.length, orders: qarOrders };
  writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2));
  console.log(`\nSaved: ${OUTPUT_JSON}`);

  // Save Excel
  if (qarOrders.length > 0) {
    const rows = qarOrders.map((o, i) => ({
      '#':                  i + 1,
      'Order ID':           o.reference_id ?? o.id,
      'Date':               (o.date ?? '').slice(0, 19),
      'Status':             o.status,
      'Customer':           o.customer_name,
      'Email':              o.customer_email,
      'Phone':              o.mobile_code ? `${o.mobile_code}${o.customer_phone}` : o.customer_phone,
      'City':               o.customer_city,
      'Country':            o.customer_country,
      'Amount (QAR)':       o.total_amount,
      'Amount (SAR)':       o.total_sar,
      'Exchange Rate':      o.exchange_rate,
      'Payment Method':     o.payment_method,
      'Source':             o.source,
      'Items':              (o.items ?? []).map(it => `${it.name} ×${it.quantity}`).join(' | '),
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 5 }, { wch: 15 }, { wch: 22 }, { wch: 30 },
      { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 15 }, { wch: 15 },
    ];
    xlsx.utils.book_append_sheet(wb, ws, 'QAR Orders');
    xlsx.writeFile(wb, OUTPUT_EXCEL);
    console.log(`Saved: ${OUTPUT_EXCEL}`);
  }
}

run().catch(err => { console.error(err.message); process.exit(1); });
