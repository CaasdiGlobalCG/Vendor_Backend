// ============================================================
// FILE: logSanitizer.js
// PURPOSE: Strip sensitive fields (passwords, tokens, secrets)
//          before writing to DynamoDB or console logs.
// CONNECTS TO: securityLogger.js, requestLogger.js
// ============================================================

/**
 * Fields that must never appear in log output.
 * Case-insensitive matching is used for key comparison.
 * @type {Set<string>}
 */
const SENSITIVE_KEYS = new Set([
  'password', 'newpassword', 'oldpassword', 'confirmpassword',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken',
  'secret', 'secretkey', 'apikey', 'api_key',
  'creditcard', 'cardnumber', 'cvv', 'ssn',
  'authorization',
]);

const REDACTED = '***REDACTED***';

/**
 * Recursively sanitize an object by redacting sensitive field values.
 * Returns a shallow copy — does NOT mutate the original.
 *
 * @param {Object} obj — Object to sanitize
 * @param {number} [depth=3] — Max recursion depth (prevents circular ref issues)
 * @returns {Object} Sanitized copy
 */
export function sanitize(obj, depth = 3) {
  if (!obj || typeof obj !== 'object' || depth <= 0) return obj;

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => sanitize(item, depth - 1));
  }

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      clean[key] = REDACTED;
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = sanitize(value, depth - 1);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}
