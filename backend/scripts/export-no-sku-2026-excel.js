/**
 * Export no-sku-ordered-2026.json to an Excel file.
 * Usage: node scripts/export-no-sku-2026-excel.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import xlsx from 'xlsx';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(path.join(root, 'no-sku-ordered-2026.json'), 'utf8'));

const rows = data.map((p, i) => ({
  '#':            i + 1,
  'Product ID':   p.id,
  'Name':         p.name ?? '',
  'Type':         p.type ?? '',
  'Status':       p.status ?? '',
  'Price (SAR)':  p.price?.amount ?? '',
  'SKU':          p.sku ?? '',
  'Quantity':     p.quantity ?? '',
  'Sold':         p.sold_quantity ?? '',
  'Categories':   (p.categories ?? []).map(c => c.name).join(' / '),
  'Brand':        p.brand?.name ?? '',
  'URL':          p.url ?? '',
  'Updated At':   p.updated_at ?? '',
}));

const wb = xlsx.utils.book_new();
const ws = xlsx.utils.json_to_sheet(rows);

// Column widths
ws['!cols'] = [
  { wch: 4  },  // #
  { wch: 14 },  // Product ID
  { wch: 40 },  // Name
  { wch: 10 },  // Type
  { wch: 10 },  // Status
  { wch: 12 },  // Price
  { wch: 12 },  // SKU
  { wch: 10 },  // Quantity
  { wch: 8  },  // Sold
  { wch: 35 },  // Categories
  { wch: 15 },  // Brand
  { wch: 45 },  // URL
  { wch: 20 },  // Updated At
];

xlsx.utils.book_append_sheet(wb, ws, 'No-SKU Ordered 2026');

const outPath = path.join(root, 'no-sku-ordered-2026.xlsx');
xlsx.writeFile(wb, outPath);
console.log(`Saved → ${outPath}`);
