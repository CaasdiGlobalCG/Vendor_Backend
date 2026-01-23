import express from 'express';
import jwt from 'jsonwebtoken';
import { getPem } from '../utils/jwksUtils.js';
import { createSession, getTokenForSession } from '../utils/sessionStore.js';
import * as DynamoUser from '../models/DynamoUser.js';

const router = express.Router();

// In-memory one-time code store (dev-friendly). For multi-instance/prod, back with DynamoDB/Redis.
const handoffStore = new Map();
const HANDOFF_TTL_MS = 60 * 1000;

function randomCode() {
  // URL-safe-ish code
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanupExpired() {
  const now = Date.now();
  for (const [code, value] of handoffStore.entries()) {
    if (!value || value.expiresAt <= now) {
      handoffStore.delete(code);
    }
  }
}

async function verifyCognitoToken(token) {
  const decodedToken = jwt.decode(token, { complete: true });
  if (!decodedToken) throw new Error('Invalid token');
  const kid = decodedToken.header.kid;
  const pem = getPem(kid);
  if (!pem) throw new Error('Invalid key ID');

  return await new Promise((resolve, reject) => {
    jwt.verify(token, pem, { algorithms: ['RS256'] }, (err, decoded) => {
      if (err) reject(err);
      else resolve(decoded);
    });
  });
}

async function upsertUsersLastSelectedRole(email, lastSelectedRole) {
  if (!email || !lastSelectedRole) return;
  const now = new Date().toISOString();
  try {
    const existing = await DynamoUser.getUserByEmail(email);
    if (existing) {
      await DynamoUser.updateUser(existing.userId || existing.id, {
        lastSelectedRole,
        lastSelectedRoleUpdatedAt: now,
      });
      return;
    }

    await DynamoUser.createUser({
      email,
      displayName: email.split('@')[0],
      lastSelectedRole,
      lastSelectedRoleUpdatedAt: now,
      status: 'pending',
      hasFilledForm: false,
      roleSelected: false,
    });
  } catch (e) {
    console.warn('[users] failed to upsert lastSelectedRole:', e?.message);
  }
}

function getCookieValue(req, name) {
  const cookieHeader = req.headers?.cookie;
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map((p) => p.trim());
  for (const part of parts) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    if (key === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

function getAuthTokenFromRequest(req) {
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring('Bearer '.length);
  }

  const cookieName = process.env.VENDOR_AUTH_COOKIE_NAME || 'vg_auth';
  const cookieVal = getCookieValue(req, cookieName);
  if (!cookieVal) return null;
  const looksLikeJwt = cookieVal.split('.').length === 3;
  if (looksLikeJwt) return cookieVal;
  return getTokenForSession(cookieVal);
}

// POST /api/auth/session
// Establishes a vendor httpOnly auth cookie (sid) from a Cognito JWT.
// Useful for migrating older clients that still hold the JWT client-side.
router.post('/session', async (req, res) => {
  try {
    const authHeader = req.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing token' });
    }

    const token = authHeader.substring('Bearer '.length);
    const decoded = await verifyCognitoToken(token);

    const cookieName = process.env.VENDOR_AUTH_COOKIE_NAME || 'vg_auth';
    const sameSiteRaw = (process.env.VENDOR_AUTH_COOKIE_SAMESITE || 'Lax').toLowerCase();
    let sameSite = sameSiteRaw === 'none' ? 'None' : sameSiteRaw === 'strict' ? 'Strict' : 'Lax';
    let secure = sameSite === 'None';

    const host = String(req.hostname || '').toLowerCase();
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (isLocalhost && sameSite === 'None') {
      sameSite = 'Lax';
      secure = false;
    }

    const configuredDomain = process.env.VENDOR_AUTH_COOKIE_DOMAIN || '';
    const reqHost = String(req.hostname || '');
    let cookieDomain;
    if (configuredDomain) {
      const normalized = configuredDomain.startsWith('.') ? configuredDomain.slice(1) : configuredDomain;
      if (reqHost === normalized || reqHost.endsWith(`.${normalized}`)) cookieDomain = configuredDomain;
    }

    const sid = createSession(token);

    res.setHeader('Cache-Control', 'no-store');
    res.cookie(cookieName, sid, {
      httpOnly: true,
      secure,
      sameSite,
      domain: cookieDomain || undefined,
      path: '/',
    });

    // Mark that the last-used app/role for this user is vendor.
    await upsertUsersLastSelectedRole(decoded?.email, 'vendor');

    return res.json({ success: true });
  } catch (e) {
    console.error('[auth/session] error:', e?.message);
    return res.status(401).json({ error: 'Not authenticated' });
  }
});

// POST /api/auth/logout
// Clears the vendor auth cookie.
router.post('/logout', async (req, res) => {
  const cookieName = process.env.VENDOR_AUTH_COOKIE_NAME || 'vg_auth';

  const sameSiteRaw = (process.env.VENDOR_AUTH_COOKIE_SAMESITE || 'Lax').toLowerCase();
  let sameSite = sameSiteRaw === 'none' ? 'None' : sameSiteRaw === 'strict' ? 'Strict' : 'Lax';
  let secure = sameSite === 'None';

  const host = String(req.hostname || '').toLowerCase();
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocalhost && sameSite === 'None') {
    sameSite = 'Lax';
    secure = false;
  }

  const configuredDomain = process.env.VENDOR_AUTH_COOKIE_DOMAIN || '';
  const reqHost = String(req.hostname || '');
  let cookieDomain;
  if (configuredDomain) {
    const normalized = configuredDomain.startsWith('.') ? configuredDomain.slice(1) : configuredDomain;
    if (reqHost === normalized || reqHost.endsWith(`.${normalized}`)) cookieDomain = configuredDomain;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure,
    sameSite,
    domain: cookieDomain || undefined,
    path: '/',
  });

  return res.json({ success: true });
});

// POST /api/auth/handoff
// Creates a one-time code that the client app can exchange for the JWT.
router.post('/handoff', async (req, res) => {
  try {
    cleanupExpired();
    const token = getAuthTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const decoded = await verifyCognitoToken(token);
    const email = decoded?.email;
    if (!email) return res.status(400).json({ error: 'Token missing email' });

    const code = randomCode();
    handoffStore.set(code, {
      token,
      email,
      expiresAt: Date.now() + HANDOFF_TTL_MS,
    });

    return res.json({ code, expiresInMs: HANDOFF_TTL_MS });
  } catch (e) {
    console.error('[handoff] error:', e?.message);
    return res.status(401).json({ error: 'Not authenticated' });
  }
});

// GET /api/auth/handoff/exchange?code=...
// Exchanges the code for the JWT, then invalidates the code.
router.get('/handoff/exchange', async (req, res) => {
  try {
    cleanupExpired();
    const code = req.query.code;
    if (!code) return res.status(400).json({ error: 'Missing code' });

    const entry = handoffStore.get(code);
    if (!entry) return res.status(404).json({ error: 'Invalid or expired code' });

    if (entry.expiresAt <= Date.now()) {
      handoffStore.delete(code);
      return res.status(404).json({ error: 'Invalid or expired code' });
    }

    // One-time use
    handoffStore.delete(code);

    const cookieName = process.env.CLIENT_AUTH_COOKIE_NAME || 'cg_auth';
    const sameSiteRaw = (process.env.CLIENT_AUTH_COOKIE_SAMESITE || 'Lax').toLowerCase();
    let sameSite = sameSiteRaw === 'none' ? 'None' : sameSiteRaw === 'strict' ? 'Strict' : 'Lax';
    let secure = sameSite === 'None';

    // Local dev: SameSite=None requires Secure, which cannot be set over http://localhost.
    // Downgrade to Lax to ensure the cookie is stored in dev.
    const host = String(req.hostname || '').toLowerCase();
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (isLocalhost && sameSite === 'None') {
      sameSite = 'Lax';
      secure = false;
    }

    const configuredDomain = process.env.CLIENT_AUTH_COOKIE_DOMAIN || '';
    const reqHost = String(req.hostname || '');
    let cookieDomain;
    if (configuredDomain) {
      const normalized = configuredDomain.startsWith('.') ? configuredDomain.slice(1) : configuredDomain;
      if (reqHost === normalized || reqHost.endsWith(`.${normalized}`)) {
        cookieDomain = configuredDomain;
      } else {
        // Avoid setting an invalid Domain during local dev (browser will reject the cookie)
        console.warn('[handoff/exchange] skipping cookie Domain; host mismatch', {
          reqHost,
          configuredDomain,
        });
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.cookie(cookieName, entry.token, {
      httpOnly: true,
      secure,
      sameSite,
      domain: cookieDomain || undefined,
      path: '/',
    });

    return res.json({ success: true });
  } catch (e) {
    console.error('[handoff/exchange] error:', e?.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/handoff/vendor-exchange?code=...
// Exchanges the code and sets a vendor httpOnly auth cookie (sid → JWT stored server-side).
router.get('/handoff/vendor-exchange', async (req, res) => {
  try {
    cleanupExpired();
    const code = req.query.code;
    if (!code) return res.status(400).json({ error: 'Missing code' });

    const entry = handoffStore.get(code);
    if (!entry) return res.status(404).json({ error: 'Invalid or expired code' });
    if (entry.expiresAt <= Date.now()) {
      handoffStore.delete(code);
      return res.status(404).json({ error: 'Invalid or expired code' });
    }

    handoffStore.delete(code);

    const cookieName = process.env.VENDOR_AUTH_COOKIE_NAME || 'vg_auth';
    const sameSiteRaw = (process.env.VENDOR_AUTH_COOKIE_SAMESITE || 'Lax').toLowerCase();
    let sameSite = sameSiteRaw === 'none' ? 'None' : sameSiteRaw === 'strict' ? 'Strict' : 'Lax';
    let secure = sameSite === 'None';

    const host = String(req.hostname || '').toLowerCase();
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (isLocalhost && sameSite === 'None') {
      sameSite = 'Lax';
      secure = false;
    }

    const configuredDomain = process.env.VENDOR_AUTH_COOKIE_DOMAIN || '';
    const reqHost = String(req.hostname || '');
    let cookieDomain;
    if (configuredDomain) {
      const normalized = configuredDomain.startsWith('.') ? configuredDomain.slice(1) : configuredDomain;
      if (reqHost === normalized || reqHost.endsWith(`.${normalized}`)) cookieDomain = configuredDomain;
    }

    const sid = createSession(entry.token);

    // Mark that the last-used app/role for this user is vendor.
    try {
      const decoded = await verifyCognitoToken(entry.token);
      await upsertUsersLastSelectedRole(decoded?.email, 'vendor');
    } catch (e) {
      console.warn('[handoff/vendor-exchange] could not update users.lastSelectedRole:', e?.message);
    }

    res.setHeader('Cache-Control', 'no-store');
    res.cookie(cookieName, sid, {
      httpOnly: true,
      secure,
      sameSite,
      domain: cookieDomain || undefined,
      path: '/',
    });

    return res.json({ success: true });
  } catch (e) {
    console.error('[handoff/vendor-exchange] error:', e?.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
