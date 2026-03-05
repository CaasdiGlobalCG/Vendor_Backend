// ============================================================
// FILE: securityLogger.js
// PURPOSE: Fire-and-forget writer for security/auth events to DynamoDB
//          security_log table. Imported by auth middleware and
//          requirePermission middleware.
// CONNECTS TO: logConfig.js (actions enum, table, TTL),
//              uaParser.js (browser/OS extraction),
//              rbac/config/db.js (DynamoDB client)
// ============================================================

import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../rbac/config/db.js';
import {
  SECURITY_ACTIONS,
  SECURITY_LOG_TABLE,
  LOG_SOURCE,
  generateEventId,
  calculateTTL,
} from '../config/logConfig.js';
import { parseUserAgent } from '../utils/uaParser.js';

// Re-export so existing auth middleware imports keep working:
// `import { logSecurityEvent, SECURITY_ACTIONS } from '…/securityLogger.js'`
export { SECURITY_ACTIONS };

/**
 * Write a security event to the security_log DynamoDB table.
 * Uses fire-and-forget pattern — NEVER blocks the caller.
 *
 * @param {Object} params
 * @param {string} params.orgId        — Organization ID ("unknown" for pre-auth failures)
 * @param {string} params.action       — SECURITY_ACTIONS enum value
 * @param {string} [params.actorId]    — Cognito sub (userId)
 * @param {string} [params.actorEmail] — Actor's email address
 * @param {Object} [params.details]    — Action-specific data (reason, route, etc.)
 * @param {Object} [params.metadata]   — { ip, userAgent, requestId }
 */
export function logSecurityEvent({
  orgId = 'unknown',
  action,
  actorId = '',
  actorEmail = '',
  details = {},
  metadata = {},
}) {
  // Parse user-agent into readable browser/OS (lightweight, <0.1ms)
  const ua = parseUserAgent(metadata.userAgent);

  const eventId = generateEventId();
  const timestamp = new Date().toISOString();

  const item = {
    orgId,
    eventId,
    action,
    actorId,
    actorEmail,
    details,
    // Top-level fields for easy DynamoDB console visibility
    ip: metadata.ip || '',
    browser: ua.browser,
    os: ua.os,
    requestId: metadata.requestId || '',
    userAgent: ua.raw,
    timestamp,
    ttl: calculateTTL('security'),
    source: LOG_SOURCE,
    // Composite key for ActionIndex GSI (query without FilterExpression)
    'orgId#action': `${orgId}#${action}`,
  };

  // Fire-and-forget — never await, never block the request
  docClient.send(new PutCommand({
    TableName: SECURITY_LOG_TABLE,
    Item: item,
  })).catch(err => {
    console.error('[SECURITY_LOG] Write failed:', err.message);
  });
}
