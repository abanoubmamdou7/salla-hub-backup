import express from 'express';
import { getAdminByEmail, getAdminById, updateAdmin } from '../models/adminUser.js';
import {
  verifyPassword,
  hashPassword,
  issueSessionToken,
  issue2faTicket,
  verifyToken,
  generateTotpSecret,
  verifyTotp,
  buildTotpEnrollment,
  publicUser,
  requireAuth,
} from '../services/authService.js';

const router = express.Router();

// ── POST /auth/login ──────────────────────────────────────────────────────────
// Step 1: email + password. If TOTP is enabled, return a short-lived ticket and
// ask the client to complete /auth/2fa/verify. Otherwise issue the session token.
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const user = await getAdminByEmail(email);
    const ok = user && (await verifyPassword(password, user.passwordHash));
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.totpEnabled) {
      return res.json({ requires2fa: true, ticket: issue2faTicket(user) });
    }
    return res.json({ token: issueSessionToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /auth/2fa/verify ─────────────────────────────────────────────────────
// Step 2: exchange the ticket + 6-digit code for a session token.
router.post('/2fa/verify', async (req, res) => {
  try {
    const { ticket, code } = req.body ?? {};
    if (!ticket || !code) {
      return res.status(400).json({ error: 'Ticket and code are required' });
    }
    let payload;
    try {
      payload = verifyToken(ticket, '2fa');
    } catch {
      return res.status(401).json({ error: 'Login session expired — please sign in again' });
    }
    const user = await getAdminById(payload.sub);
    if (!user || !user.totpEnabled || !user.totpSecret) {
      return res.status(401).json({ error: 'Two-factor authentication is not active' });
    }
    if (!(await verifyTotp(code, user.totpSecret))) {
      return res.status(401).json({ error: 'Invalid authentication code' });
    }
    return res.json({ token: issueSessionToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Everything below requires a valid session.
router.use(requireAuth);

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  res.json({ user: publicUser(req.auth.user) });
});

// ── POST /auth/2fa/setup ──────────────────────────────────────────────────────
// Generate a new (pending) secret + QR code. Stored with totpEnabled=false until
// the user confirms a code via /auth/2fa/enable.
router.post('/2fa/setup', async (req, res) => {
  try {
    const user = req.auth.user;
    if (user.totpEnabled) {
      return res.status(409).json({ error: 'Two-factor authentication is already enabled' });
    }
    const secret = generateTotpSecret();
    await updateAdmin(user.id, { totpSecret: secret, totpEnabled: false });
    const { otpauth, qrDataUrl } = await buildTotpEnrollment(user.email, secret);
    res.json({ secret, otpauth, qr: qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /auth/2fa/enable ─────────────────────────────────────────────────────
router.post('/2fa/enable', async (req, res) => {
  try {
    const { code } = req.body ?? {};
    const user = req.auth.user;
    if (!user.totpSecret) {
      return res.status(400).json({ error: 'Run setup before enabling two-factor authentication' });
    }
    if (!(await verifyTotp(code, user.totpSecret))) {
      return res.status(401).json({ error: 'Invalid authentication code' });
    }
    const updated = await updateAdmin(user.id, { totpEnabled: true });
    res.json({ ok: true, user: publicUser(updated) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /auth/2fa/disable ────────────────────────────────────────────────────
// Requires the current password to turn 2FA off.
router.post('/2fa/disable', async (req, res) => {
  try {
    const { password } = req.body ?? {};
    const user = req.auth.user;
    if (!(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Incorrect password' });
    }
    const updated = await updateAdmin(user.id, { totpSecret: null, totpEnabled: false });
    res.json({ ok: true, user: publicUser(updated) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /auth/change-password ────────────────────────────────────────────────
router.post('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    const user = req.auth.user;
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await updateAdmin(user.id, { passwordHash: await hashPassword(newPassword) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
