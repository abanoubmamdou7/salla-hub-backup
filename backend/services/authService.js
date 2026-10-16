import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { generateSecret, generateURI, verify as verifyOtp } from 'otplib';
import QRCode from 'qrcode';
import {
  getAdminByEmail,
  getAdminById,
  countAdmins,
  createAdmin,
} from '../models/adminUser.js';

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';
// Short-lived ticket issued after password step while waiting for the TOTP code.
const TWOFA_TICKET_TTL = '5m';
const TOTP_ISSUER = process.env.TOTP_ISSUER || 'Salla Hub';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured — set it in .env');
  }
  return secret;
}

// ── Password helpers ──────────────────────────────────────────────────────────
export async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

// ── Token helpers ─────────────────────────────────────────────────────────────
export function issueSessionToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, typ: 'session' }, getSecret(), {
    expiresIn: JWT_EXPIRES_IN,
  });
}

export function issue2faTicket(user) {
  return jwt.sign({ sub: user.id, typ: '2fa' }, getSecret(), { expiresIn: TWOFA_TICKET_TTL });
}

export function verifyToken(token, expectedType = 'session') {
  const payload = jwt.verify(token, getSecret());
  if (expectedType && payload.typ !== expectedType) {
    throw new Error('Invalid token type');
  }
  return payload;
}

// ── TOTP (Google Authenticator) helpers ───────────────────────────────────────
export function generateTotpSecret() {
  return generateSecret();
}

export async function verifyTotp(code, secret) {
  if (!code || !secret) return false;
  try {
    // Allow ±1 time step to tolerate clock drift between phone and server.
    const result = await verifyOtp({
      token: String(code).replace(/\s+/g, ''),
      secret,
      counterTolerance: 1,
    });
    return !!result.valid;
  } catch {
    return false;
  }
}

export async function buildTotpEnrollment(email, secret) {
  const otpauth = generateURI({ issuer: TOTP_ISSUER, label: email, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  return { otpauth, qrDataUrl, secret };
}

// ── Public user shape (never leak hash / secret) ──────────────────────────────
export function publicUser(user) {
  return { id: user.id, email: user.email, totpEnabled: user.totpEnabled };
}

// ── Seed the single admin from env on startup ─────────────────────────────────
export async function seedAdminFromEnv() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('[auth] ADMIN_EMAIL / ADMIN_PASSWORD not set — no admin account will be seeded.');
    return;
  }
  const existing = await getAdminByEmail(email);
  if (existing) return;
  if ((await countAdmins()) > 0) {
    // A different admin already exists; don't create a second from env.
    return;
  }
  const passwordHash = await hashPassword(password);
  await createAdmin({ email, passwordHash });
  console.log(`[auth] Seeded admin account: ${email}`);
}

// ── Express middleware: require a valid session ───────────────────────────────
// Accepts a Bearer session JWT, or the legacy ADMIN_API_KEY (x-admin-key /
// ?admin_key) so existing service-to-service calls keep working.
export async function requireAuth(req, res, next) {
  try {
    const adminKey = process.env.ADMIN_API_KEY;
    const legacy = req.headers['x-admin-key'] || req.query.admin_key;
    if (adminKey && legacy && legacy === adminKey) {
      req.auth = { service: true };
      return next();
    }

    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const token = bearer || (typeof legacy === 'string' ? legacy : null);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const payload = verifyToken(token, 'session');
    const user = await getAdminById(payload.sub);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.auth = { userId: user.id, user };
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
