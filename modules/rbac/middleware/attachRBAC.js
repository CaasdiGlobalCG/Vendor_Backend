// ============================================================
// FILE: attachRBAC.js
// PURPOSE: Middleware that loads the current user's RBAC role and permissions
//          from DynamoDB and attaches them to the request object.
//          Runs AFTER auth + vendorId/clientId middleware.
// CONNECTS TO: rbac_members table, rbac_roles table,
//              permission.utils.js (for permission set building),
//              requirePermission.js (consumes req.rbac downstream)
// ============================================================

import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';
import { derivePlatformAccess } from '../config/modules.js';

/**
 * Determines which org ID field to use based on what's already on the request.
 * Vendor routes set req.vendorId (via attachVendorId middleware);
 * client routes set req.clientId (via attachClientId middleware).
 *
 * NOTE: This function does NOT perform its own DB lookup.
 * Org resolution from email is handled by the dedicated
 * attachVendorId / attachClientId middleware that runs BEFORE attachRBAC.
 *
 * @param {Object} req - Express request
 * @returns {{ orgId: string, orgType: string } | null}
 */
function resolveOrg(req) {
  if (req.vendorId) return { orgId: req.vendorId, orgType: 'vendor' };
  if (req.clientId) return { orgId: req.clientId, orgType: 'client' };
  return null;
}

/**
 * Middleware: Load RBAC membership and role for the current user.
 *
 * Sets on req:
 *   req.rbac.orgId        — organization ID (vendorId or clientId)
 *   req.rbac.orgType      — 'vendor' or 'client'
 *   req.rbac.userId       — user's Cognito sub
 *   req.rbac.roleId       — assigned role ID
 *   req.rbac.roleName     — display name of the role
 *   req.rbac.roleLevel    — numeric level (0 = Super Admin)
 *   req.rbac.permissions  — array of permission strings
 *   req.rbac.permissionSet — Set for O(1) lookups
 *   req.rbac.isSuperAdmin — boolean shortcut
 *
 * Phase 1 behavior (PERMISSIVE MODE):
 *   If no RBAC membership is found, proceeds with a default Super Admin grant
 *   so existing single-owner accounts keep working. Logs a warning for tracking.
 *   This will be tightened in Phase 4 when permission enforcement goes live.
 */
export async function attachRBAC(req, res, next) {
  try {
    const org = resolveOrg(req);
    if (!org) {
      // No org context — skip RBAC (some routes don't need it, like public endpoints)
      req.rbac = null;
      return next();
    }

    // userId comes from different auth middleware shapes
    const userId = req.auth?.sub || req.user?.sub || req.user?.id;
    if (!userId) {
      req.rbac = null;
      return next();
    }

    // Step 1: Look up membership
    const memberResult = await docClient.send(new GetCommand({
      TableName: TABLES.MEMBERS,
      Key: { orgId: org.orgId, userId },
      ProjectionExpression: 'roleId, roleName, #s, email, permissionOverrides, platformAccess',
      ExpressionAttributeNames: { '#s': 'status' },
    }));

    const member = memberResult.Item;

    // PERMISSIVE MODE: If no membership found, grant Super Admin fallback
    // AND auto-create the rbac_members record so email is resolvable in future
    if (!member) {
      const email = req.auth?.email || req.user?.email || '';
      const displayName = req.auth?.name || email;
      console.warn(`[RBAC] No membership found for user=${userId} org=${org.orgId}. Auto-creating member record & granting Super Admin.`);

      // Fire-and-forget: create the member record so future lookups find this user
      const now = new Date().toISOString();
      docClient.send(new PutCommand({
        TableName: TABLES.MEMBERS,
        Item: {
          orgId: org.orgId,
          userId,
          email,
          displayName,
          roleId: 'super_admin',
          roleName: 'Super Admin',
          status: 'active',
          platformAccess: ['vendor', 'client', 'sales'],
          invitedBy: 'system_auto',
          joinedAt: now,
          lastActiveAt: now,
        },
        ConditionExpression: 'attribute_not_exists(userId)',
      })).catch(err => {
        if (err.name !== 'ConditionalCheckFailedException') {
          console.error('[RBAC] Failed to auto-create member record:', err.message);
        }
      });

      req.rbac = {
        orgId: org.orgId,
        orgType: org.orgType,
        userId,
        roleId: 'super_admin',
        roleName: 'Super Admin',
        roleLevel: 0,
        permissions: ['*:*'],
        permissionSet: new Set(['*:*']),
        isSuperAdmin: true,
        platformAccess: ['vendor', 'client', 'sales'],
        _fallback: true,
      };
      return next();
    }

    // Check if member is suspended. Auto-reactivate when timed suspension has expired.
    if (member.status === 'suspended') {
      const suspendedUntilRaw = member.suspendedUntil || null;
      const suspendedUntilMs = suspendedUntilRaw ? Date.parse(suspendedUntilRaw) : NaN;
      const suspensionExpired = Number.isFinite(suspendedUntilMs) && suspendedUntilMs <= Date.now();

      if (suspensionExpired) {
        const now = new Date().toISOString();
        await docClient.send(new UpdateCommand({
          TableName: TABLES.MEMBERS,
          Key: { orgId: member.orgId, userId: member.userId },
          UpdateExpression: 'SET #s = :active, updatedAt = :now, unsuspendedAt = :now, unsuspendedBy = :system, unsuspendReason = :reason',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':active': 'active',
            ':now': now,
            ':system': 'system_auto_unsuspend',
            ':reason': 'Suspension duration elapsed',
          },
        }));
        member.status = 'active';
      } else {
        return res.status(403).json({
          error: 'Account suspended',
          code: 'RBAC_002',
          message: 'Your access has been suspended. Contact your organization admin.',
          suspendedUntil: suspendedUntilRaw,
        });
      }
    }

    // Check if member is removed
    if (member.status === 'removed') {
      return res.status(403).json({
        error: 'Access revoked',
        code: 'RBAC_001',
        message: 'You no longer have access to this organization.',
      });
    }

    // Step 2: Look up role to get permissions
    // 'permissions' is a DynamoDB reserved keyword — must alias it
    const roleResult = await docClient.send(new GetCommand({
      TableName: TABLES.ROLES,
      Key: { orgId: org.orgId, roleId: member.roleId },
      ProjectionExpression: 'roleName, roleLevel, #perms',
      ExpressionAttributeNames: { '#perms': 'permissions' },
    }));

    const role = roleResult.Item;
    if (!role) {
      // Role record missing — shouldn't happen, but handle gracefully
      console.error(`[RBAC] Role ${member.roleId} not found for org=${org.orgId}. Denying access.`);
      return res.status(403).json({
        error: 'Role configuration error',
        code: 'RBAC_001',
        message: 'Your role configuration is invalid. Contact your organization admin.',
      });
    }

    // Step 3: Attach RBAC context to request
    // Apply per-member permission overrides if they exist
    // Defensive: handle permissions stored as DDB Set (SS) or List (L)
    let permissions = Array.isArray(role.permissions)
      ? role.permissions
      : role.permissions instanceof Set
        ? [...role.permissions]
        : [];
    const overrides = member.permissionOverrides;
    if (overrides && !permissions.includes('*:*')) {
      const permSet = new Set(permissions);
      if (Array.isArray(overrides.added)) overrides.added.forEach(p => permSet.add(p));
      if (Array.isArray(overrides.removed)) overrides.removed.forEach(p => permSet.delete(p));
      permissions = [...permSet];
    }
    // platformAccess: auto-derived from the user's resolved permissions + org type
    // WHY: Scoped by orgType so vendor invites don't leak client access
    const platformAccess = derivePlatformAccess(permissions, org.orgType);

    req.rbac = {
      orgId: org.orgId,
      orgType: org.orgType,
      userId,
      roleId: member.roleId,
      roleName: role.roleName,
      roleLevel: role.roleLevel,
      permissions,
      permissionSet: new Set(permissions),
      isSuperAdmin: permissions.includes('*:*'),
      permissionOverrides: overrides || null,
      platformAccess,
      _fallback: false,
    };

    return next();
  } catch (error) {
    console.error('[RBAC] Error loading RBAC context:', error?.name, error?.message, error?.stack);
    // PERMISSIVE MODE: On error, don't block the request — log and continue
    // TODO(RBAC-P4): Change to 500 error when enforcement is live
    console.warn('[RBAC] Falling back to Super Admin due to error (Phase 1 permissive mode).');
    const orgFallback = req.vendorId
      ? { orgId: req.vendorId, orgType: 'vendor' }
      : req.clientId
        ? { orgId: req.clientId, orgType: 'client' }
        : { orgId: undefined, orgType: undefined };
    req.rbac = {
      orgId: orgFallback.orgId,
      orgType: orgFallback.orgType,
      userId: req.auth?.sub || req.user?.sub,
      roleId: 'super_admin',
      roleName: 'Super Admin (Error Fallback)',
      roleLevel: 0,
      permissions: ['*:*'],
      permissionSet: new Set(['*:*']),
      isSuperAdmin: true,
      platformAccess: ['vendor', 'client', 'sales'],
      _fallback: true,
    };
    return next();
  }
}
