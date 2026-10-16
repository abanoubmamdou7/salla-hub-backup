/**
 * Normalize an IP string to IPv4 when possible (e.g. from x-forwarded-for).
 * @param {string|undefined|null} ip
 * @returns {string|null}
 */
export function normalizeToIPv4(ip) {
  if (!ip) return null;
  const s = String(ip).trim();

  // ::1 -> 127.0.0.1
  if (s === '::1') return '127.0.0.1';

  // ::ffff:127.0.0.1 -> 127.0.0.1
  const m = s.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (m) return m[1];

  // If already IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s)) return s;

  return null;
}
