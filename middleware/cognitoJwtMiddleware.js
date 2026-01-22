import jwt from 'jsonwebtoken';
import { getPem } from '../utils/jwksUtils.js';

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

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Missing token' });
    }

    const token = authHeader.substring('Bearer '.length);
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
