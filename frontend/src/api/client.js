const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export function getApiBase() {
  return BASE;
}

export async function api(path, options = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

export function ordersList(params = {}) {
  const sp = new URLSearchParams();
  if (params.status   != null && params.status   !== '') sp.set('status',   params.status);
  if (params.tenantId != null && params.tenantId !== '') sp.set('tenantId', String(params.tenantId));
  if (params.search   != null && params.search   !== '') sp.set('search',   params.search);
  sp.set('limit',  String(params.limit  ?? 50));
  sp.set('offset', String(params.offset ?? 0));
  if (params.summary) sp.set('summary', 'true');
  return api(`/orders?${sp}`);
}

export function ordersStats() {
  return api('/orders/stats');
}

export function orderById(id) {
  return api(`/orders/${encodeURIComponent(id)}`);
}

// ── Brands ────────────────────────────────────────────────────────────────────
export function brandsList() {
  return api('/brands');
}

export function brandCreate(body) {
  return api('/brands', { method: 'POST', body: JSON.stringify(body) });
}

export function brandUpdate(id, body) {
  return api(`/brands/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export function brandDelete(id) {
  return api(`/brands/${id}`, { method: 'DELETE' });
}

// ── Clients (admin) ───────────────────────────────────────────────────────────
function adminHeaders() {
  const token = localStorage.getItem('salla_hub_token') || import.meta.env.VITE_ADMIN_API_KEY || '';
  return token ? { 'x-admin-key': token } : {};
}

export function clientsList() {
  return api('/admin/clients', { headers: adminHeaders() });
}

export function clientGet(id) {
  return api(`/admin/clients/${id}`, { headers: adminHeaders() });
}

export function clientCreate(body) {
  return api('/admin/clients', { method: 'POST', body: JSON.stringify(body), headers: adminHeaders() });
}

export function clientUpdate(id, body) {
  return api(`/admin/clients/${id}`, { method: 'PUT', body: JSON.stringify(body), headers: adminHeaders() });
}

export function clientDelete(id) {
  return api(`/admin/clients/${id}`, { method: 'DELETE', headers: adminHeaders() });
}

export function clientStores(id) {
  return api(`/admin/clients/${id}/stores`, { headers: adminHeaders() });
}

export function clientAuthUrl(id) {
  return api(`/admin/clients/${id}/auth-url`, { headers: adminHeaders() });
}

export function clientAddStore(id, body) {
  return api(`/admin/clients/${id}/stores`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify(body) });
}

// ── System ────────────────────────────────────────────────────────────────────
export function pollLogs(limit = 5) {
  return api(`/poll-logs?limit=${limit}`);
}

// ── Server logs (admin) ─────────────────────────────────────────────────────────
export function systemLogs({ level, search, sinceId, limit } = {}) {
  const sp = new URLSearchParams();
  if (level   && level !== 'all') sp.set('level', level);
  if (search)                     sp.set('search', search);
  if (sinceId != null)            sp.set('sinceId', String(sinceId));
  if (limit   != null)            sp.set('limit', String(limit));
  return api(`/admin/logs?${sp}`, { headers: adminHeaders() });
}

export function systemLogsClear() {
  return api('/admin/logs', { method: 'DELETE', headers: adminHeaders() });
}
