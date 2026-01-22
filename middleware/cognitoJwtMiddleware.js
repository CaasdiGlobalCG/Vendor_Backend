import jwt from 'jsonwebtoken';
import { getPem } from '../utils/jwksUtils.js';
import { getTokenForSession } from '../utils/sessionStore.js';

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
  const cookieName = process.env.VENDOR_AUTH_COOKIE_NAME || 'vg_auth';
  const cookieVal = getCookieValue(req, cookieName);
  if (cookieVal) {
    const looksLikeJwt = cookieVal.split('.').length === 3;
    if (looksLikeJwt) return cookieVal;

    const tokenFromSession = getTokenForSession(cookieVal);
    if (tokenFromSession) return tokenFromSession;
  }

  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring('Bearer '.length);
  }
  return null;
}

export async function authenticateCognitoJwt(req, res, next) {
  try {
    // Support Passport session (Google OAuth) if present
    if (typeof req.isAuthenticated === 'function' && req.isAuthenticated() && req.user?.email) {
      req.auth = {
        sub: req.user?.id || req.user?._id || null,
        email: req.user.email,
        name: req.user.displayName || req.user.name || null,
      };
      return next();
    }

    const token = getAuthTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Missing token' });
    }
    const decodedToken = jwt.decode(token, { complete: true });
    if (!decodedToken) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const kid = decodedToken?.header?.kid;
    const pem = kid ? getPem(kid) : null;
    if (!pem) {
      return res.status(401).json({ success: false, message: 'Invalid key ID' });
    }

    const decoded = await new Promise((resolve, reject) => {
      jwt.verify(token, pem, { algorithms: ['RS256'] }, (err, payload) => {
        if (err) reject(err);
        else resolve(payload);
      });
    });

    req.auth = {
      sub: decoded?.sub || null,
      email: decoded?.email || null,
      name: decoded?.name || null,
      token,
    };

    if (!req.auth.email) {
      return res.status(401).json({ success: false, message: 'Token missing email' });
    }

    return next();
  } catch (err) {
    console.error('[authenticateCognitoJwt] error:', err?.message || err);
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
}
