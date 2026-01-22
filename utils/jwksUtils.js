import axios from 'axios';
import jwkToPem from 'jwk-to-pem';
import dotenv from 'dotenv';

dotenv.config();

let jwks = { keys: [] };
let lastFetchedAt = 0;
const JWKS_REFRESH_MS = 60 * 60 * 1000; // 1 hour

async function fetchJwks(force = false) {
  const now = Date.now();
  if (!force && jwks?.keys?.length && now - lastFetchedAt < JWKS_REFRESH_MS) return;

  const region = process.env.AWS_REGION;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!region || !userPoolId) {
    console.warn('[jwks] Missing AWS_REGION or COGNITO_USER_POOL_ID');
    return;
  }

  try {
    const response = await axios.get(
      `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`
    );
    jwks = response.data;
    lastFetchedAt = now;
  } catch (error) {
    console.error('[jwks] Error fetching JWKS:', error?.message || error);
  }
}

// Initial fetch (best-effort)
fetchJwks().catch(() => undefined);

export function getPem(kid) {
  try {
    const key = jwks?.keys?.find((k) => k.kid === kid);
    if (!key) {
      // Best-effort refresh in background; caller remains sync.
      fetchJwks(true).catch(() => undefined);
      return null;
    }
    return jwkToPem(key);
  } catch (e) {
    console.error('[jwks] getPem error:', e?.message || e);
    return null;
  }
}
