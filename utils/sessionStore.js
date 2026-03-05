// ============================================================
// FILE: utils/sessionStore.js
// PURPOSE: DynamoDB-backed session store with sliding + absolute TTL.
//          Stores large Cognito JWTs server-side; only a short sid goes
//          in the httpOnly cookie. Survives server restarts and deploys.
// CONNECTS TO: modules/rbac/config/db.js (shared DynamoDB docClient),
//              routes/handoffRoutes.js, middleware/cognitoJwtMiddleware.js
// ============================================================

import crypto from 'crypto';
import { PutCommand, GetCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../modules/rbac/config/db.js';

/** DynamoDB table — create with scripts/createSessionTable.js */
const TABLE = process.env.SESSION_TABLE || 'app_sessions';

/** Sliding idle timeout — extends on every valid read (8 hours) */
const IDLE_TTL_MS = 8 * 60 * 60 * 1000;

/** Absolute maximum session lifetime (7 days) — even with activity */
const ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Generate a cryptographically secure session ID (32 bytes, base64url).
 * @returns {string} 43-char URL-safe session ID
 */
function generateSid() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Create a new session backed by DynamoDB.
 * @param {string} token - Cognito JWT to store server-side
 * @param {number} [idleTtlMs] - Sliding idle TTL in ms (default 8h)
 * @returns {Promise<string>} Session ID (sid) to put in the cookie
 */
export async function createSession(token, idleTtlMs = IDLE_TTL_MS) {
  const sid = generateSid();
  const now = Date.now();
  const idleExpiresAt = now + idleTtlMs;
  const absoluteExpiresAt = now + ABSOLUTE_TTL_MS;
  // DynamoDB TTL uses epoch seconds
  const ttl = Math.floor(Math.min(idleExpiresAt, absoluteExpiresAt) / 1000);

  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: {
      sid,
      token,
      createdAt: now,
      idleExpiresAt,
      absoluteExpiresAt,
      ttl, // DynamoDB auto-deletes expired items (free cleanup)
    },
  }));

  return sid;
}

/**
 * Retrieve the JWT for a session, applying sliding window renewal.
 * Returns null if the session doesn't exist or is expired.
 * @param {string} sid - Session ID from cookie
 * @returns {Promise<string|null>} JWT or null
 */
export async function getTokenForSession(sid) {
  if (!sid) return null;

  try {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE,
      Key: { sid },
    }));

    const item = result.Item;
    if (!item) return null;

    const now = Date.now();

    // Check absolute timeout (hard limit, no extension)
    if (item.absoluteExpiresAt && now >= item.absoluteExpiresAt) {
      // Fire-and-forget delete
      docClient.send(new DeleteCommand({ TableName: TABLE, Key: { sid } })).catch(() => {});
      return null;
    }

    // Check idle timeout
    if (item.idleExpiresAt && now >= item.idleExpiresAt) {
      docClient.send(new DeleteCommand({ TableName: TABLE, Key: { sid } })).catch(() => {});
      return null;
    }

    // Sliding renewal: extend idle timeout on every valid access
    const newIdleExpiresAt = now + IDLE_TTL_MS;
    const effectiveExpiry = Math.min(newIdleExpiresAt, item.absoluteExpiresAt || newIdleExpiresAt);
    const newTtl = Math.floor(effectiveExpiry / 1000);

    // Fire-and-forget — don't block the response for a TTL update
    docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { sid },
      UpdateExpression: 'SET idleExpiresAt = :idle, #t = :ttl',
      ExpressionAttributeNames: { '#t': 'ttl' },
      ExpressionAttributeValues: { ':idle': newIdleExpiresAt, ':ttl': newTtl },
    })).catch((err) => {
      console.warn('[sessionStore] sliding renewal failed:', err?.message);
    });

    return item.token;
  } catch (err) {
    console.error('[sessionStore] getTokenForSession error:', err?.message);
    return null;
  }
}

/**
 * Delete a session (logout).
 * @param {string} sid - Session ID to delete
 * @returns {Promise<void>}
 */
export async function deleteSession(sid) {
  if (!sid) return;
  try {
    await docClient.send(new DeleteCommand({
      TableName: TABLE,
      Key: { sid },
    }));
  } catch (err) {
    console.warn('[sessionStore] deleteSession error:', err?.message);
  }
}
