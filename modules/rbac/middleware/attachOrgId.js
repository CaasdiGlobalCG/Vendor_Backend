// ============================================================
// FILE: attachOrgId.js
// PURPOSE: Generic org resolver for the RBAC modular monolith.
//          Resolves ANY org type (vendor OR client) from the
//          authenticated user's Cognito sub via rbac_members.
//          This lets client/sales backends call vendor's /api/rbac/me
//          and get their correct RBAC context without needing
//          vendor-specific attachVendorId middleware.
// CONNECTS TO: cognitoJwtMiddleware.js (needs req.auth.sub),
//              rbac_members table (UserOrgsIndex GSI),
//              rbac_organizations table (orgType + native ID lookup),
//              attachRBAC.js (consumes req.parentOrgId + req.orgType)
// ============================================================

import { QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';

/**
 * Middleware: Resolve the caller's RBAC org from their Cognito sub.
 *
 * Strategy (org-type agnostic):
 * 1. If req.parentOrgId already set → skip (upstream middleware resolved it)
 * 2. Query rbac_members.UserOrgsIndex by userId (Cognito sub)
 * 3. Pick the first active membership
 * 4. Get rbac_organizations to read orgType + native ID (vendorId/clientId)
 * 5. Set req.parentOrgId, req.orgType, and optionally req.vendorId/req.clientId
 *
 * WHY: The old attachVendorId only resolved vendor orgs. Client/sales users
 *      calling vendor /api/rbac/me got orgType='vendor' (wrong) and the wrong
 *      module registry. This middleware resolves the correct orgType so
 *      meController returns the right module list (VENDOR vs CLIENT modules).
 *
 * @param {Object} req - Express request (needs req.auth.sub)
 * @param {Object} res - Express response
 * @param {Function} next - Express next()
 */
export async function attachOrgId(req, res, next) {
  try {
    // Skip if upstream middleware already resolved the org
    if (req.parentOrgId && req.orgType) return next();

    const userId = req.auth?.sub || req.user?.sub || req.user?.id;
    if (!userId) return next();

    // Query rbac_members.UserOrgsIndex by Cognito sub
    // A user may belong to multiple orgs — pick the first active one
    const memberResult = await docClient.send(new QueryCommand({
      TableName: TABLES.MEMBERS,
      IndexName: 'UserOrgsIndex',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ProjectionExpression: 'orgId, #s',
      ExpressionAttributeNames: { '#s': 'status' },
      Limit: 10,
    }));

    const activeMembership = memberResult.Items?.find(
      (m) => m.status === 'active' && m.orgId
    );

    if (!activeMembership?.orgId) return next();

    // Get rbac_organizations to read orgType + native ID
    const orgResult = await docClient.send(new GetCommand({
      TableName: TABLES.ORGANIZATIONS,
      Key: { orgId: activeMembership.orgId },
      ProjectionExpression: 'orgType, vendorId, clientId',
    }));

    const org = orgResult.Item;
    const orgType = org?.orgType || 'vendor';
    const nativeVendorId = org?.vendorId || null;
    const nativeClientId = org?.clientId || null;

    // Set the stable RBAC org identity (used by attachRBAC's resolveOrg)
    req.parentOrgId = activeMembership.orgId;
    req.orgType = orgType;

    // Set native IDs so downstream vendor/client-specific code still works
    if (orgType === 'vendor' && nativeVendorId) {
      req.vendorId = nativeVendorId;
    } else if (orgType === 'client' && nativeClientId) {
      req.clientId = nativeClientId;
    } else {
      // Fallback: native ID not stamped on rbac_organizations yet
      // (backfill may not have run). Use the RBAC org UUID as fallback
      // so downstream code doesn't crash — RBAC itself works with the UUID.
      if (orgType === 'vendor') req.vendorId = activeMembership.orgId;
      if (orgType === 'client') req.clientId = activeMembership.orgId;
    }

    req.isTeamMember = true;
    return next();
  } catch (err) {
    // Non-blocking: log and continue without org context
    console.warn('[attachOrgId] Failed to resolve org:', err.message);
    return next();
  }
}
