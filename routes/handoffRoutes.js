import express from 'express';
import jwt from 'jsonwebtoken';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getPem } from '../utils/jwksUtils.js';
import { createSession, getTokenForSession } from '../utils/sessionStore.js';
import * as DynamoUser from '../models/DynamoUser.js';
import * as DynamoVendor from '../modules/vendor/models/DynamoVendor.js';
import { docClient } from '../modules/rbac/config/db.js';
import { TABLES } from '../modules/rbac/config/tables.js';
import { derivePlatformAccess } from '../modules/rbac/config/modules.js';
import { logSecurityEvent, SECURITY_ACTIONS } from '../modules/logging/services/securityLogger.js';

const router = express.Router();

// In-memory one-time code store (dev-friendly). For multi-instance/prod, back with DynamoDB/Redis.
const handoffStore = new Map();
const HANDOFF_TTL_MS = 60 * 1000;
const HANDOFF_MIN_TOKEN_TTL_SECONDS = Number(process.env.HANDOFF_MIN_TOKEN_TTL_SECONDS || 120);

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

async function getAuthTokenFromRequest(req) {
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring('Bearer '.length).trim();
    if (token) return token;
  }

  const cookieName = process.env.VENDOR_AUTH_COOKIE_NAME || 'vg_auth';
  const cookieVal = getCookieValue(req, cookieName);
  if (!cookieVal) return null;
  const looksLikeJwt = cookieVal.split('.').length === 3;
  if (looksLikeJwt) return cookieVal;
  return await getTokenForSession(cookieVal);
}

async function getAuthTokenFromRequestOrBody(req) {
  const fromReq = await getAuthTokenFromRequest(req);
  if (fromReq) return fromReq;

  const bodyToken = req.body?.token || req.body?.authToken || null;
  if (!bodyToken) return null;
  const token = String(bodyToken).trim();
  if (!token) return null;
  return token;
}

async function getVendorAccessGateByUserId(userId) {
  if (!userId) {
    return { allowed: true };
  }

  try {
    const memResult = await docClient.send(new QueryCommand({
      TableName: process.env.RBAC_MEMBERS_TABLE || 'rbac_members',
      IndexName: 'UserOrgsIndex',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ProjectionExpression: 'orgType, #s, roleId, roleName',
      ExpressionAttributeNames: { '#s': 'status' },
      Limit: 20,
    }));

    const allMemberships = memResult.Items || [];
    const vendorMemberships = allMemberships.filter((m) => m.orgType === 'vendor');
    const scoped = vendorMemberships.length ? vendorMemberships : allMemberships;

    if (!scoped.length) {
      return { allowed: true };
    }

    const hasActiveSuperAdmin = scoped.some((m) => {
      if (m.status !== 'active') return false;
      const roleId = String(m.roleId || '').toLowerCase();
      const roleName = String(m.roleName || '').toLowerCase();
      return roleId === 'super_admin' || roleId === 'superadmin' || roleName === 'super admin';
    });

    if (hasActiveSuperAdmin) {
      return { allowed: true };
    }

    const hasRemoved = scoped.some((m) => m.status === 'removed');
    const hasActive = scoped.some((m) => m.status === 'active');

    if (hasRemoved && !hasActive) {
      return {
        allowed: false,
        code: 'RBAC_001',
        message: 'Your access has been revoked.',
      };
    }

    return { allowed: true };
  } catch (err) {
    console.warn('[auth] vendor access gate check failed (allowing login):', err?.message);
    return { allowed: true };
  }
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

    // Block removed members before establishing login session; allow Super Admin.
    const accessGate = await getVendorAccessGateByUserId(decoded?.sub);
    if (!accessGate.allowed) {
      return res.status(403).json({ error: accessGate.message, code: accessGate.code });
    }

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

    const sid = await createSession(token);

    res.setHeader('Cache-Control', 'no-store');
    res.cookie(cookieName, sid, {
      httpOnly: true,
      secure,
      sameSite,
      domain: cookieDomain || undefined,
      path: '/',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours — matches sliding session TTL
    });

    // Mark that the last-used app/role for this user is vendor.
    await upsertUsersLastSelectedRole(decoded?.email, 'vendor');

    // Log actual LOGIN_SUCCESS — this is the real "login" event
    const vendorRecord = decoded?.email ? await DynamoVendor.getVendorByEmail(decoded.email).catch(() => null) : null;
    logSecurityEvent({
      orgId: vendorRecord?.vendorId || 'unknown',
      action: SECURITY_ACTIONS.LOGIN_SUCCESS,
      actorId: decoded?.sub || '',
      actorEmail: decoded?.email || '',
      metadata: { ip: req.ip || req.connection?.remoteAddress, userAgent: req.get('user-agent'), requestId: req.requestId },
    });

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
    const token = await getAuthTokenFromRequestOrBody(req);
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const decoded = await verifyCognitoToken(token);
    const email = decoded?.email;
    if (!email) return res.status(400).json({ error: 'Token missing email' });

    // Prevent issuing handoff codes for tokens that are too close to expiry.
    // This avoids a common race where handoff is created successfully but exchange fails moments later.
    const expSeconds = Number(decoded?.exp || 0);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds = expSeconds - nowSeconds;
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= HANDOFF_MIN_TOKEN_TTL_SECONDS) {
      return res.status(401).json({
        error: 'Token expiring too soon for handoff',
        code: 'TOKEN_EXPIRED',
        message: 'Your session is about to expire. Please sign in again before switching apps.',
        remainingSeconds: Math.max(0, ttlSeconds),
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    let vendorId = null;
    try {
      const vendorRecord =
        (await DynamoVendor.getVendorByEmail(normalizedEmail)) ||
        (normalizedEmail !== email ? await DynamoVendor.getVendorByEmail(email) : null);
      vendorId = vendorRecord?.vendorId || vendorRecord?.id || null;
    } catch (e) {
      console.warn('[handoff] could not resolve vendorId:', e?.message);
    }

    // ── Platform access check ──
    // If a targetPlatform is specified, verify the user has access to it
    const targetPlatform = req.body?.targetPlatform;
    const VALID_PLATFORMS = ['vendor', 'client', 'sales'];
    if (targetPlatform && VALID_PLATFORMS.includes(targetPlatform)) {
      const userId = decoded?.sub;
      if (vendorId && userId) {
        try {
          // Fetch member's role, then role's permissions to derive platform access
          const memberResult = await docClient.send(new GetCommand({
            TableName: TABLES.MEMBERS,
            Key: { orgId: vendorId, userId },
            ProjectionExpression: 'roleId, permissionOverrides',
          }));
          const member = memberResult.Item;
          const ALL_PLATFORMS = ['vendor', 'client', 'sales'];
          // Super admins and org owners (no member record) get all platforms
          const isSuperAdmin = member?.roleId === 'super_admin';
          
          let access = ALL_PLATFORMS; // default: allow
          if (member && !isSuperAdmin) {
            // Fetch role to get permissions
            const roleResult = await docClient.send(new GetCommand({
              TableName: TABLES.ROLES,
              Key: { orgId: vendorId, roleId: member.roleId },
              ProjectionExpression: '#perms',
              ExpressionAttributeNames: { '#perms': 'permissions' },
            }));
            let rolePerms = Array.isArray(roleResult.Item?.permissions)
              ? roleResult.Item.permissions
              : roleResult.Item?.permissions instanceof Set
                ? [...roleResult.Item.permissions]
                : [];
            // Apply overrides
            const overrides = member.permissionOverrides;
            if (overrides && !rolePerms.includes('*:*')) {
              const permSet = new Set(rolePerms);
              if (Array.isArray(overrides.added)) overrides.added.forEach(p => permSet.add(p));
              if (Array.isArray(overrides.removed)) overrides.removed.forEach(p => permSet.delete(p));
              rolePerms = [...permSet];
            }
            // Handoff originates from vendor backend; orgType is always 'vendor'
            access = derivePlatformAccess(rolePerms, 'vendor');
          }
          if (!access.includes(targetPlatform)) {
            console.warn(`[handoff] User ${userId} denied handoff to ${targetPlatform} — access: [${access}]`);
            return res.status(403).json({
              error: 'Platform access denied',
              message: `You do not have access to the ${targetPlatform} platform.`,
            });
          }
        } catch (rbacErr) {
          // Phase 1 permissive: log but don't block if RBAC lookup fails
          console.warn('[handoff] platformAccess check failed, allowing (Phase 1):', rbacErr?.message);
        }
      }
    }

    const code = randomCode();
    handoffStore.set(code, {
      token,
      email: normalizedEmail,
      vendorId,
      expiresAt: Date.now() + HANDOFF_TTL_MS,
    });

    return res.json({ code, expiresInMs: HANDOFF_TTL_MS });
  } catch (e) {
    console.error('[handoff] error:', e?.message);
    return res.status(401).json({ error: 'Not authenticated' });
  }
});

// GET /api/auth/handoff/sales-exchange?code=...
// Exchanges the one-time code for vendor-safe bootstrap data for the Sales UI.
// This avoids putting authToken/vendorId in the URL.
router.get('/handoff/sales-exchange', async (req, res) => {
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

    const entryDecoded = await verifyCognitoToken(entry.token);
    const accessGate = await getVendorAccessGateByUserId(entryDecoded?.sub);
    if (!accessGate.allowed) {
      return res.status(403).json({ error: accessGate.message, code: accessGate.code });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      authToken: entry.token,
      vendorId: entry.vendorId || null,
      email: entry.email || null,
    });
  } catch (e) {
    console.error('[handoff/sales-exchange] error:', e?.message);
    return res.status(500).json({ error: 'Server error' });
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

    const sid = await createSession(entry.token);

    // Mark that the last-used app/role for this user is vendor.
    try {
      await upsertUsersLastSelectedRole(entryDecoded?.email, 'vendor');
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
      maxAge: 8 * 60 * 60 * 1000, // 8 hours — matches sliding session TTL
    });

    // Log LOGIN_SUCCESS for handoff vendor exchange
    try {
      const vendorRecord = entryDecoded?.email ? await DynamoVendor.getVendorByEmail(entryDecoded.email).catch(() => null) : null;
      logSecurityEvent({
        orgId: vendorRecord?.vendorId || 'unknown',
        action: SECURITY_ACTIONS.LOGIN_SUCCESS,
        actorId: entryDecoded?.sub || '',
        actorEmail: entryDecoded?.email || '',
        details: { method: 'handoff-vendor-exchange' },
        metadata: { ip: req.ip || req.connection?.remoteAddress, userAgent: req.get('user-agent'), requestId: req.requestId },
      });
    } catch (logErr) {
      console.warn('[handoff/vendor-exchange] failed to log LOGIN_SUCCESS:', logErr?.message);
    }

    return res.json({ success: true });
  } catch (e) {
    console.error('[handoff/vendor-exchange] error:', e?.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
