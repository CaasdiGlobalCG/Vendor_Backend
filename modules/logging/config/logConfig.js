// ============================================================
// FILE: logConfig.js
// PURPOSE: Central configuration for the logging module — action enums,
//          TTL values, table names, log levels, and source identifiers.
// CONNECTS TO: securityLogger.js, requestLogger.js, errorLogger.js
// ============================================================

import crypto from 'crypto';

/**
 * Security event action constants.
 * Used by auth middleware and requirePermission to log security-relevant events.
 * @enum {string}
 */
export const SECURITY_ACTIONS = Object.freeze({
  LOGIN_SUCCESS:       'LOGIN_SUCCESS',
  LOGIN_FAILED:        'LOGIN_FAILED',
  TOKEN_EXPIRED:       'TOKEN_EXPIRED',
  TOKEN_INVALID:       'TOKEN_INVALID',
  PERMISSION_DENIED:   'PERMISSION_DENIED',
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
  PASSWORD_CHANGED:    'PASSWORD_CHANGED',
  LOGOUT:              'LOGOUT',
  GLOBAL_SIGNOUT:      'GLOBAL_SIGNOUT',
  TOKEN_REFRESH:       'TOKEN_REFRESH',
  ACCOUNT_LOCKED:      'ACCOUNT_LOCKED',
});

/**
 * Log severity levels — used by requestLogger and errorLogger for structured output.
 * @enum {string}
 */
export const LOG_LEVELS = Object.freeze({
  ERROR: 'ERROR',
  WARN:  'WARN',
  INFO:  'INFO',
  DEBUG: 'DEBUG',
});

/**
 * DynamoDB table name for security logs (separate from org_activity_log).
 * WHY separate: PII (IPs), admin-only access, shorter TTL, different partition patterns.
 */
export const SECURITY_LOG_TABLE = process.env.SECURITY_LOG_TABLE || 'security_log';

/**
 * TTL durations in seconds for automatic DynamoDB item expiry.
 * DynamoDB auto-deletes expired items at zero WCU cost.
 */
export const TTL_SECONDS = Object.freeze({
  security: 180 * 86400,   // 180 days (6 months)
});

/**
 * Source identifier for this backend — included in every log entry.
 * Allows filtering logs by backend when all share the same table.
 */
export const LOG_SOURCE = 'vendor-backend';

/**
 * Paths to skip in request logging — health checks, static assets, etc.
 * WHY: Reduces noise and DynamoDB/console write volume by ~30%.
 */
export const SKIP_LOG_PATHS = new Set([
  '/health',
  '/',
  '/api/health',
  '/favicon.ico',
]);

/**
 * Generate a unique event ID for DynamoDB sort key.
 * Format: ISO timestamp + random suffix — guarantees time ordering + uniqueness.
 *
 * @returns {string} e.g. "2026-03-05T10:30:00.123Z#a1b2c3d4"
 */
export function generateEventId() {
  return `${new Date().toISOString()}#${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Calculate TTL epoch for a given category.
 *
 * @param {'security'} category — Log category
 * @returns {number} Unix epoch in seconds
 */
export function calculateTTL(category) {
  const seconds = TTL_SECONDS[category] || TTL_SECONDS.security;
  return Math.floor(Date.now() / 1000) + seconds;
}
