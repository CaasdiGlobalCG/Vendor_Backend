// ============================================================
// FILE: membersController.js
// PURPOSE: CRUD operations for organization members.
//          List members, invite new members, change roles, remove members.
// CONNECTS TO: rbac_members table, rbac_roles table, rbac_invitations table,
//              rbac_audit_log table, permission.utils.js, roles.js
// ============================================================

import { QueryCommand, GetCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';
import { canManageUser } from '../utils/permission.utils.js';
import { VENDOR_DEFAULT_ROLES, CLIENT_DEFAULT_ROLES } from '../config/roles.js';
import { derivePlatformAccess } from '../config/modules.js';
import { sendInvitationEmail, sendRemovalEmail } from '../services/emailService.js';
import crypto from 'crypto';

/**
 * GET /api/rbac/members
 * List all active members of the current org.
 * Requires: user_management:view permission (enforced via requirePermission).
 *
 * Query params:
 *   - limit (default 50, max 100)
 *   - lastKey (base64 encoded pagination key)
 *   - search (email prefix filter — client-side for now)
 */
export async function listMembers(req, res) {
  try {
    const { orgId } = req.rbac;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const lastKeyRaw = req.query.lastKey;

    const params = {
      TableName: TABLES.MEMBERS,
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
      Limit: limit,
    };

    // Cursor-based pagination
    if (lastKeyRaw) {
      try {
        params.ExclusiveStartKey = JSON.parse(
          Buffer.from(lastKeyRaw, 'base64').toString('utf-8')
        );
      } catch {
        return res.status(400).json({ error: 'Invalid lastKey' });
      }
    }

    const result = await docClient.send(new QueryCommand(params));
    const members = (result.Items || []).filter((m) => m.status !== 'removed');

    // Optional: client-side search filter on email
    const search = req.query.search?.toLowerCase();
    const filtered = search
      ? members.filter((m) => m.email?.toLowerCase().includes(search))
      : members;

    const lastKey = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null;

    return res.status(200).json({
      members: filtered,
      lastKey,
      hasMore: !!result.LastEvaluatedKey,
      total: filtered.length,
    });
  } catch (error) {
    console.error('[RBAC] listMembers error:', error);
    return res.status(500).json({ error: 'Failed to list members' });
  }
}

/**
 * POST /api/rbac/members/invite
 * Invite a new member to the org by email + roleId.
 * Creates both an invitation record and a pending member record.
 * Requires: user_management:create permission.
 *
 * Body: { email, roleId, message? }
 */
export async function inviteMember(req, res) {
  try {
    const { orgId, orgType, userId: callerId, roleLevel: callerLevel } = req.rbac;
    const { email, roleId, message, permissionOverrides } = req.body;

    // ── Validation ──
    if (!email || !roleId) {
      return res.status(400).json({ error: 'email and roleId are required' });
    }

    // Validate permissionOverrides shape if provided
    let validatedOverrides = null;
    if (permissionOverrides && typeof permissionOverrides === 'object') {
      const added = Array.isArray(permissionOverrides.added) ? permissionOverrides.added.filter(p => typeof p === 'string') : [];
      const removed = Array.isArray(permissionOverrides.removed) ? permissionOverrides.removed.filter(p => typeof p === 'string') : [];
      if (added.length > 0 || removed.length > 0) {
        validatedOverrides = { added, removed };
      }
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // ── Check target role exists (include permissions for platform derivation) ──
    const roleResult = await docClient.send(new GetCommand({
      TableName: TABLES.ROLES,
      Key: { orgId, roleId },
      ProjectionExpression: 'roleId, roleName, roleLevel, #perms',
      ExpressionAttributeNames: { '#perms': 'permissions' },
    }));

    const targetRole = roleResult.Item;
    if (!targetRole) {
      return res.status(400).json({ error: `Role '${roleId}' not found in this organization` });
    }

    // ── Hierarchy check: can't assign a role at your own level or higher ──
    if (!canManageUser(callerLevel, targetRole.roleLevel)) {
      return res.status(403).json({
        error: 'Cannot assign this role',
        message: 'You can only assign roles below your own authority level.',
      });
    }

    // ── Check if member already exists ──
    const existingResult = await docClient.send(new QueryCommand({
      TableName: TABLES.MEMBERS,
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :email AND orgId = :orgId',
      ExpressionAttributeValues: { ':email': normalizedEmail, ':orgId': orgId },
      Limit: 1,
    }));

    if (existingResult.Items?.length > 0) {
      const existing = existingResult.Items[0];
      if (existing.status === 'active') {
        return res.status(409).json({ error: 'This email is already a member of the organization' });
      }
      if (existing.status === 'invited') {
        return res.status(409).json({ error: 'An invitation is already pending for this email' });
      }
    }

    // ── Cross-org membership check: ensure user isn't active in another org ──
    const crossOrgResult = await docClient.send(new QueryCommand({
      TableName: TABLES.MEMBERS,
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :email',
      FilterExpression: '#s IN (:active, :invited)',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':email': normalizedEmail, ':active': 'active', ':invited': 'invited' },
    }));

    const otherOrgMembership = (crossOrgResult.Items || []).find(m => m.orgId !== orgId);
    if (otherOrgMembership) {
      return res.status(409).json({
        error: 'Member belongs to another organization',
        message: 'This person is currently associated with another organization. They must be removed from their current organization before they can be invited to yours.',
      });
    }

    // ── Derive platformAccess from role's effective permissions ──
    let rolePerms = Array.isArray(targetRole.permissions)
      ? targetRole.permissions
      : targetRole.permissions instanceof Set
        ? [...targetRole.permissions]
        : [];
    // Apply overrides to get effective permissions for derivation
    if (validatedOverrides) {
      const permSet = new Set(rolePerms);
      if (validatedOverrides.added) validatedOverrides.added.forEach(p => permSet.add(p));
      if (validatedOverrides.removed) validatedOverrides.removed.forEach(p => permSet.delete(p));
      rolePerms = [...permSet];
    }
    const autoPlatformAccess = derivePlatformAccess(rolePerms, orgType);

    // ── Create invitation ──
    const inviteId = `inv_${crypto.randomUUID()}`;
    const inviteToken = crypto.randomUUID();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    const invitation = {
      inviteId,
      orgId,
      orgType,
      email: normalizedEmail,
      roleId,
      roleName: targetRole.roleName,
      invitedBy: callerId,
      inviteToken,
      status: 'pending',
      message: message || '',
      platformAccess: autoPlatformAccess,
      ...(validatedOverrides && { permissionOverrides: validatedOverrides }),
      createdAt: now,
      expiresAt,
    };

    await docClient.send(new PutCommand({
      TableName: TABLES.INVITATIONS,
      Item: invitation,
    }));

    // ── Create pending member record ──
    const memberRecord = {
      orgId,
      userId: `pending_${inviteId}`,
      email: normalizedEmail,
      roleId,
      roleName: targetRole.roleName,
      status: 'invited',
      inviteId,
      invitedBy: callerId,
      platformAccess: autoPlatformAccess,
      ...(validatedOverrides && { permissionOverrides: validatedOverrides }),
      joinedAt: now,
      updatedAt: now,
    };

    await docClient.send(new PutCommand({
      TableName: TABLES.MEMBERS,
      Item: memberRecord,
    }));

    // ── Audit log ──
    await logAudit(orgId, callerId, 'MEMBER_INVITED', {
      targetEmail: normalizedEmail,
      roleId,
      inviteId,
      ...(validatedOverrides && { hasOverrides: true }),
    }, req.auth?.email);

    // ── Send invitation email ──
    // Fetch org name for the email template
    let orgName = orgId; // fallback to orgId if lookup fails
    try {
      const orgResult = await docClient.send(new GetCommand({
        TableName: TABLES.ORGANIZATIONS,
        Key: { orgId },
        ProjectionExpression: 'orgName',
      }));
      if (orgResult.Item?.orgName) orgName = orgResult.Item.orgName;
    } catch (orgErr) {
      console.warn('[RBAC] Could not fetch org name for invite email:', orgErr.message);
    }

    // Inviter name from auth context (Cognito JWT decoded name)
    const inviterName = req.auth?.name || req.auth?.email || 'A team member';

    const emailResult = await sendInvitationEmail({
      to: normalizedEmail,
      inviteToken,
      orgName,
      roleName: targetRole.roleName,
      inviterName,
      message,
      orgType,
    });

    return res.status(201).json({
      invitation: {
        inviteId: invitation.inviteId,
        email: invitation.email,
        roleId: invitation.roleId,
        roleName: invitation.roleName,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      },
      emailSent: emailResult.success,
      message: emailResult.success
        ? `Invitation sent to ${normalizedEmail}`
        : `Invitation created for ${normalizedEmail} (email delivery pending)`,
    });
  } catch (error) {
    console.error('[RBAC] inviteMember error:', error);
    return res.status(500).json({ error: 'Failed to send invitation' });
  }
}

/**
 * PATCH /api/rbac/members/:userId/role
 * Change a member's role.
 * Requires: user_management:edit permission.
 *
 * Body: { roleId }
 */
export async function changeMemberRole(req, res) {
  try {
    const { orgId, userId: callerId, roleLevel: callerLevel } = req.rbac;
    const { userId: targetUserId } = req.params;
    const { roleId: newRoleId } = req.body;

    if (!newRoleId) {
      return res.status(400).json({ error: 'roleId is required' });
    }

    // ── Can't change your own role ──
    if (targetUserId === callerId) {
      return res.status(403).json({ error: 'You cannot change your own role' });
    }

    // ── Verify target member exists ──
    const memberResult = await docClient.send(new GetCommand({
      TableName: TABLES.MEMBERS,
      Key: { orgId, userId: targetUserId },
    }));

    const targetMember = memberResult.Item;
    if (!targetMember || targetMember.status === 'removed') {
      return res.status(404).json({ error: 'Member not found' });
    }

    // ── Verify target member's current role level ──
    const currentRoleResult = await docClient.send(new GetCommand({
      TableName: TABLES.ROLES,
      Key: { orgId, roleId: targetMember.roleId },
      ProjectionExpression: 'roleLevel',
    }));

    const currentRoleLevel = currentRoleResult.Item?.roleLevel ?? 999;

    // ── Hierarchy check: can't manage a user at the same or higher level ──
    if (!canManageUser(callerLevel, currentRoleLevel)) {
      return res.status(403).json({
        error: 'Insufficient authority',
        message: 'You cannot manage a member with equal or higher authority.',
      });
    }

    // ── Verify new role exists ──
    const newRoleResult = await docClient.send(new GetCommand({
      TableName: TABLES.ROLES,
      Key: { orgId, roleId: newRoleId },
      ProjectionExpression: 'roleId, roleName, roleLevel',
    }));

    const newRole = newRoleResult.Item;
    if (!newRole) {
      return res.status(400).json({ error: `Role '${newRoleId}' not found` });
    }

    // ── Hierarchy check: can't assign a role at your level or higher ──
    if (!canManageUser(callerLevel, newRole.roleLevel)) {
      return res.status(403).json({
        error: 'Cannot assign this role',
        message: 'You can only assign roles below your own authority level.',
      });
    }

    // ── Update ──
    const now = new Date().toISOString();
    await docClient.send(new UpdateCommand({
      TableName: TABLES.MEMBERS,
      Key: { orgId, userId: targetUserId },
      UpdateExpression: 'SET roleId = :roleId, roleName = :roleName, updatedAt = :now',
      ExpressionAttributeValues: {
        ':roleId': newRoleId,
        ':roleName': newRole.roleName,
        ':now': now,
      },
    }));

    // ── Audit log ──
    await logAudit(orgId, callerId, 'ROLE_CHANGED', {
      targetUserId,
      oldRoleId: targetMember.roleId,
      newRoleId,
    }, req.auth?.email);

    return res.status(200).json({
      member: {
        userId: targetUserId,
        email: targetMember.email,
        roleId: newRoleId,
        roleName: newRole.roleName,
        updatedAt: now,
      },
      message: `Role updated to ${newRole.roleName}`,
    });
  } catch (error) {
    console.error('[RBAC] changeMemberRole error:', error);
    return res.status(500).json({ error: 'Failed to change role' });
  }
}

/**
 * DELETE /api/rbac/members/:userId
 * Remove a member from the org (soft delete — sets status to 'removed').
 * Requires: user_management:delete permission.
 */
export async function removeMember(req, res) {
  try {
    const { orgId, orgType, userId: callerId, roleLevel: callerLevel } = req.rbac;
    const { userId: targetUserId } = req.params;
    const { reason } = req.body || {};

    // ── Reason is required ──
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A reason for removal is required' });
    }
    const trimmedReason = String(reason).trim().slice(0, 500);

    // ── Can't remove yourself ──
    if (targetUserId === callerId) {
      return res.status(403).json({ error: 'You cannot remove yourself from the organization' });
    }

    // ── Verify target member exists ──
    const memberResult = await docClient.send(new GetCommand({
      TableName: TABLES.MEMBERS,
      Key: { orgId, userId: targetUserId },
    }));

    const targetMember = memberResult.Item;
    if (!targetMember || targetMember.status === 'removed') {
      return res.status(404).json({ error: 'Member not found' });
    }

    // ── Hierarchy check ──
    const targetRoleResult = await docClient.send(new GetCommand({
      TableName: TABLES.ROLES,
      Key: { orgId, roleId: targetMember.roleId },
      ProjectionExpression: 'roleLevel',
    }));

    const targetRoleLevel = targetRoleResult.Item?.roleLevel ?? 999;
    if (!canManageUser(callerLevel, targetRoleLevel)) {
      return res.status(403).json({
        error: 'Insufficient authority',
        message: 'You cannot remove a member with equal or higher authority.',
      });
    }

    // ── Soft delete with reason ──
    const now = new Date().toISOString();
    await docClient.send(new UpdateCommand({
      TableName: TABLES.MEMBERS,
      Key: { orgId, userId: targetUserId },
      UpdateExpression: 'SET #s = :removed, updatedAt = :now, removedBy = :caller, removalReason = :reason, removedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':removed': 'removed',
        ':now': now,
        ':caller': callerId,
        ':reason': trimmedReason,
      },
    }));

    // ── Audit log ──
    await logAudit(orgId, callerId, 'MEMBER_REMOVED', {
      targetUserId,
      targetEmail: targetMember.email,
      previousRole: targetMember.roleId,
      reason: trimmedReason,
    }, req.auth?.email);

    // ── Send removal notification email (best-effort) ──
    let orgName = orgId;
    try {
      const orgResult = await docClient.send(new GetCommand({
        TableName: TABLES.ORGANIZATIONS,
        Key: { orgId },
        ProjectionExpression: 'orgName',
      }));
      if (orgResult.Item?.orgName) orgName = orgResult.Item.orgName;
    } catch (orgErr) {
      console.warn('[RBAC] Could not fetch org name for removal email:', orgErr.message);
    }

    const removerName = req.auth?.name || req.auth?.email || 'An administrator';
    sendRemovalEmail({
      to: targetMember.email,
      orgName,
      removedByName: removerName,
      reason: trimmedReason,
      orgType: orgType || 'vendor',
    }).catch(err => console.error('[RBAC] Removal email error:', err.message));

    return res.status(200).json({
      success: true,
      message: `${targetMember.email} has been removed from the organization`,
    });
  } catch (error) {
    console.error('[RBAC] removeMember error:', error);
    return res.status(500).json({ error: 'Failed to remove member' });
  }
}

/**
 * POST /api/rbac/members/:userId/suspend
 * Suspend a member (optionally until datetime).
 */
export async function suspendMember(req, res) {
  try {
    const { orgId, userId: callerId, roleLevel: callerLevel } = req.rbac;
    const { userId: targetUserId } = req.params;
    const { reason, suspendedUntil } = req.body || {};

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A reason for suspension is required' });
    }
    if (targetUserId === callerId) {
      return res.status(403).json({ error: 'You cannot suspend yourself' });
    }

    const memberResult = await docClient.send(new GetCommand({
      TableName: TABLES.MEMBERS,
      Key: { orgId, userId: targetUserId },
    }));
    const targetMember = memberResult.Item;
    if (!targetMember || targetMember.status === 'removed') {
      return res.status(404).json({ error: 'Member not found' });
    }

    const targetRoleResult = await docClient.send(new GetCommand({
      TableName: TABLES.ROLES,
      Key: { orgId, roleId: targetMember.roleId },
      ProjectionExpression: 'roleLevel',
    }));
    const targetRoleLevel = targetRoleResult.Item?.roleLevel ?? 999;
    if (!canManageUser(callerLevel, targetRoleLevel)) {
      return res.status(403).json({
        error: 'Insufficient authority',
        message: 'You cannot suspend a member with equal or higher authority.',
      });
    }

    let normalizedSuspendedUntil = null;
    if (suspendedUntil) {
      const parsed = new Date(suspendedUntil);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Invalid suspendedUntil datetime' });
      }
      if (parsed.getTime() <= Date.now()) {
        return res.status(400).json({ error: 'suspendedUntil must be in the future' });
      }
      normalizedSuspendedUntil = parsed.toISOString();
    }

    const now = new Date().toISOString();
    const trimmedReason = String(reason).trim().slice(0, 500);
    await docClient.send(new UpdateCommand({
      TableName: TABLES.MEMBERS,
      Key: { orgId, userId: targetUserId },
      UpdateExpression: 'SET #s = :suspended, updatedAt = :now, suspendedAt = :now, suspendedBy = :caller, suspensionReason = :reason, suspendedUntil = :until',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':suspended': 'suspended',
        ':now': now,
        ':caller': callerId,
        ':reason': trimmedReason,
        ':until': normalizedSuspendedUntil,
      },
    }));

    await logAudit(orgId, callerId, 'MEMBER_SUSPENDED', {
      targetUserId,
      targetEmail: targetMember.email,
      reason: trimmedReason,
      suspendedUntil: normalizedSuspendedUntil,
    }, req.auth?.email);

    return res.status(200).json({
      success: true,
      message: `${targetMember.email} has been suspended`,
      member: {
        userId: targetUserId,
        email: targetMember.email,
        status: 'suspended',
        suspendedAt: now,
        suspendedUntil: normalizedSuspendedUntil,
      },
    });
  } catch (error) {
    console.error('[RBAC] suspendMember error:', error);
    return res.status(500).json({ error: 'Failed to suspend member' });
  }
}

/**
 * POST /api/rbac/members/:userId/unsuspend
 * Unsuspend a suspended member.
 */
export async function unsuspendMember(req, res) {
  try {
    const { orgId, userId: callerId, roleLevel: callerLevel } = req.rbac;
    const { userId: targetUserId } = req.params;
    const { reason } = req.body || {};

    if (targetUserId === callerId) {
      return res.status(403).json({ error: 'You cannot unsuspend yourself' });
    }

    const memberResult = await docClient.send(new GetCommand({
      TableName: TABLES.MEMBERS,
      Key: { orgId, userId: targetUserId },
    }));
    const targetMember = memberResult.Item;
    if (!targetMember || targetMember.status === 'removed') {
      return res.status(404).json({ error: 'Member not found' });
    }
    if (targetMember.status !== 'suspended') {
      return res.status(400).json({ error: 'Member is not suspended' });
    }

    const targetRoleResult = await docClient.send(new GetCommand({
      TableName: TABLES.ROLES,
      Key: { orgId, roleId: targetMember.roleId },
      ProjectionExpression: 'roleLevel',
    }));
    const targetRoleLevel = targetRoleResult.Item?.roleLevel ?? 999;
    if (!canManageUser(callerLevel, targetRoleLevel)) {
      return res.status(403).json({
        error: 'Insufficient authority',
        message: 'You cannot unsuspend a member with equal or higher authority.',
      });
    }

    const now = new Date().toISOString();
    const unsuspendReason = reason ? String(reason).trim().slice(0, 500) : null;
    await docClient.send(new UpdateCommand({
      TableName: TABLES.MEMBERS,
      Key: { orgId, userId: targetUserId },
      UpdateExpression: 'SET #s = :active, updatedAt = :now, unsuspendedAt = :now, unsuspendedBy = :caller, unsuspendReason = :reason',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':active': 'active',
        ':now': now,
        ':caller': callerId,
        ':reason': unsuspendReason,
      },
    }));

    await logAudit(orgId, callerId, 'MEMBER_UNSUSPENDED', {
      targetUserId,
      targetEmail: targetMember.email,
      reason: unsuspendReason,
    }, req.auth?.email);

    return res.status(200).json({
      success: true,
      message: `${targetMember.email} has been reactivated`,
      member: {
        userId: targetUserId,
        email: targetMember.email,
        status: 'active',
        unsuspendedAt: now,
      },
    });
  } catch (error) {
    console.error('[RBAC] unsuspendMember error:', error);
    return res.status(500).json({ error: 'Failed to unsuspend member' });
  }
}

// ──────────────────────────────────────
// HELPERS
// ──────────────────────────────────────

/**
 * Log an audit event to rbac_audit_log.
 * Fire-and-forget — never blocks the main request.
 */
async function logAudit(orgId, userId, action, details = {}, actorEmail = null) {
  try {
    const eventId = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const item = {
      orgId,
      eventId,
      userId,
      action,
      details,
      timestamp: new Date().toISOString(),
    };
    if (actorEmail) item.actorEmail = actorEmail;
    await docClient.send(new PutCommand({
      TableName: TABLES.AUDIT_LOG,
      Item: item,
    }));
  } catch (error) {
    // Never block the main request for audit failures
    console.error('[RBAC] Audit log error:', error?.message);
  }
}
