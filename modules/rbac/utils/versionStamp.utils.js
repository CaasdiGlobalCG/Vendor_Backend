// ============================================================
// FILE: utils/versionStamp.utils.js
// PURPOSE: Permission invalidation helper for the RBAC modular monolith.
//          Increments `orgPermissionVersion` on rbac_organizations whenever
//          a member's role changes, a role's permissions change, or a member
//          is added/removed/suspended. Client/sales backends store this version
//          in session and re-fetch RBAC from vendor /api/rbac/me when it
//          changes — keeping cached session permissions fresh without
//          per-request vendor calls.
// CONNECTS TO: config/db.js (docClient), config/tables.js (ORGANIZATIONS)
// ============================================================

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';

/**
 * Atomically increment the org's permission version stamp.
 * Call this after ANY mutation that affects a user's effective permissions:
 *   - Member invited (new member gets a role)
 *   - Member's role changed
 *   - Member removed/suspended/unsuspended
 *   - Member access scopes changed
 *   - Role created/updated/deleted (affects all members with that role)
 *   - Permission overrides applied to a member
 *
 * Uses DynamoDB atomic ADD operation — safe under concurrent updates.
 * Non-blocking: logs on failure but never throws (don't break the mutation
 * that triggered the bump).
 *
 * @param {string} orgId - RBAC organization ID (rbac_organizations PK)
 * @returns {Promise<void>}
 */
export async function bumpOrgPermissionVersion(orgId) {
  if (!orgId) return;
  try {
    await docClient.send(new UpdateCommand({
      TableName: TABLES.ORGANIZATIONS,
      Key: { orgId },
      UpdateExpression: 'ADD orgPermissionVersion :one SET updatedAt = :now',
      ExpressionAttributeValues: {
        ':one': 1,
        ':now': new Date().toISOString(),
      },
    }));
  } catch (err) {
    // Non-blocking — the mutation that triggered this should still succeed.
    // Stale version just means client/sales re-fetch on next mismatch.
    console.warn('[versionStamp] bumpOrgPermissionVersion failed:', err?.message);
  }
}
