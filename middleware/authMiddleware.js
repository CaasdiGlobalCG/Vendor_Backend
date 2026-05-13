/**
 * FILE: middleware/authMiddleware.js
 * PURPOSE: Verifies Cognito RS256 JWT from the Authorization header.
 *          Rejects all other identity sources (query params, body, x-user-info).
 *          Validates token_use claim and refreshes JWKS on unknown kid.
 * CONNECTS TO: All protected routes in Vendor_Backend
 *
 * FIX C1: Replaced broken stub (accepted unauthenticated identity from query
 *         params / request body / x-user-info header) with proper JWKS
 *         RS256 JWT verification matching sales-backend pattern.
 * FIX H5: Added token_use === 'id' validation.
 * FIX M1: JWKS cache refreshes on unknown kid before rejecting.
 */
import jwt from 'jsonwebtoken';
import jwkToPem from 'jwk-to-pem';
import fetch from 'node-fetch';

/** JWKS cache: { pems: { [kid]: string }, fetchedAt: number } */
let jwksCache = null;
const JWKS_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function fetchJwks(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.pems;
  }

  const region = process.env.AWS_REGION;
  const poolId = process.env.COGNITO_USER_POOL_ID;
  if (!region || !poolId) {
    throw new Error('AWS_REGION and COGNITO_USER_POOL_ID must be set');
  }

  const url = `https://cognito-idp.${region}.amazonaws.com/${poolId}/.well-known/jwks.json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`JWKS fetch failed: HTTP ${response.status}`);

  const data = await response.json();
  const pems = {};
  for (const key of data.keys) {
    pems[key.kid] = jwkToPem({ kty: key.kty, n: key.n, e: key.e });
  }
  jwksCache = { pems, fetchedAt: Date.now() };
  return pems;
}

/**
 * Verifies the Cognito id-token JWT in the Authorization header.
 * Sets req.user from the verified payload only — never from client-supplied headers.
 */
export const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authorization token required.' });
    }

    const token = authHeader.substring(7);
    const decodedHeader = jwt.decode(token, { complete: true });
    if (!decodedHeader) {
      return res.status(401).json({ success: false, message: 'Invalid token format.' });
    }

    const kid = decodedHeader.header.kid;

    // Attempt verification; if kid is unknown, refresh JWKS once and retry
    let pems = await fetchJwks();
    if (!pems[kid]) {
      pems = await fetchJwks(true);
      if (!pems[kid]) {
        return res.status(401).json({ success: false, message: 'Authentication failed: unknown signing key.' });
      }
    }

    let payload;
    try {
      payload = jwt.verify(token, pems[kid], { algorithms: ['RS256'] });
    } catch (err) {
      return res.status(401).json({ success: false, message: `Authentication failed: ${err.message}` });
    }

    // [FIX H5] Enforce token_use — only accept Cognito id tokens
    if (payload.token_use !== 'id') {
      return res.status(401).json({ success: false, message: 'Authentication failed: invalid token type.' });
    }

    // Set req.user exclusively from the verified payload — no client-supplied fallback
    req.user = {
      sub:   payload.sub,
      email: payload.email,
      role:  payload['custom:role'] || null,
    };

    next();
  } catch (error) {
    console.error('Authentication middleware error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error during authentication.' });
  }
};

// ── Removed: all fallback identity sources (x-user-info, query params, body)
// ── These allowed unauthenticated callers to impersonate any user (C1 fix)

/**
 * Middleware: user must have role === 'vendor'
 */
export const requireVendor = (req, res, next) => {
  if (req.user?.role !== 'vendor') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Vendor role required.'
    });
  }
  next();
};

/**
 * Middleware to check if user is a PM
 */
export const requirePM = (req, res, next) => {
  if (req.user?.role !== 'pm') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. PM role required.'
    });
  }
  next();
};

/**
 * Middleware to check if user is a client
 */
export const requireClient = (req, res, next) => {
  if (req.user?.role !== 'client') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Client role required.'
    });
  }
  next();
};

/**
 * Middleware: vendor users can only access their own data.
 * vendorId is taken from req.user.sub (verified JWT sub) — NOT from request body/query.
 */
export const checkVendorAccess = (req, res, next) => {
  const user = req.user;
  if (user.role === 'pm') {
    return next(); // PMs can access all vendor data
  }
  if (user.role === 'vendor') {
    return next(); // vendorId scoping is enforced inside each controller via req.user.sub
  }
  return res.status(403).json({ success: false, message: 'Invalid user role.' });
};
