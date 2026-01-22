// Dev-friendly in-memory session store.
// Stores large Cognito JWTs server-side and only sends a short session id in the httpOnly cookie.

const sessions = new Map();
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

function randomSid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanupExpired(now = Date.now()) {
  for (const [sid, entry] of sessions.entries()) {
    if (!entry || entry.expiresAt <= now) sessions.delete(sid);
  }
}

export function createSession(token, ttlMs = DEFAULT_TTL_MS) {
  cleanupExpired();
  const sid = randomSid();
  sessions.set(sid, { token, expiresAt: Date.now() + ttlMs });
  return sid;
}

export function getTokenForSession(sid) {
  if (!sid) return null;
  cleanupExpired();
  const entry = sessions.get(sid);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return entry.token;
}

export function deleteSession(sid) {
  if (!sid) return;
  sessions.delete(sid);
}
