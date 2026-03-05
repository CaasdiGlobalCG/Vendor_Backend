// ============================================================
// FILE: inviteAcceptController.js
// PURPOSE: Public (no-auth) endpoints for invitation acceptance flow.
//          Validates invite tokens, creates Cognito users, activates members.
// CONNECTS TO: rbac_invitations (TokenIndex GSI), rbac_members, rbac_roles,
//              rbac_organizations, Cognito AdminCreateUser, emailService.js
// ============================================================

import { QueryCommand, GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { docClient } from '../config/db.js';
import { TABLES, EXISTING_TABLES } from '../config/tables.js';
import crypto from 'crypto';

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// ──────────────────────────────────────
// GET /api/rbac/invite/validate?token=...
// Public endpoint — no auth required. Called by the InviteAcceptPage
// to display org name, role, and email before the user sets up their password.
// ──────────────────────────────────────

/**
 * Validate an invitation token and return display info.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function validateInviteToken(req, res) {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ valid: false, error: 'Token is required' });
    }

    // Look up invitation by token via TokenIndex GSI
    const result = await docClient.send(new QueryCommand({
      TableName: TABLES.INVITATIONS,
      IndexName: 'TokenIndex',
      KeyConditionExpression: 'inviteToken = :token',
      ExpressionAttributeValues: { ':token': token },
      Limit: 1,
    }));

    const invitation = result.Items?.[0];
    if (!invitation) {
      return res.status(404).json({ valid: false, error: 'Invitation not found' });
    }

    // Check status
    if (invitation.status === 'accepted') {
      return res.status(400).json({ valid: false, error: 'This invitation has already been accepted' });
    }
    if (invitation.status === 'cancelled') {
      return res.status(400).json({ valid: false, error: 'This invitation has been cancelled' });
    }

    // Check expiry
    if (new Date(invitation.expiresAt) < new Date()) {
      // Auto-mark as expired
      await docClient.send(new UpdateCommand({
        TableName: TABLES.INVITATIONS,
        Key: { inviteId: invitation.inviteId },
        UpdateExpression: 'SET #s = :expired',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':expired': 'expired' },
      }));
      return res.status(400).json({ valid: false, error: 'This invitation has expired' });
    }

    // Fetch org name for display
    let orgName = invitation.orgId;
    try {
      const orgResult = await docClient.send(new GetCommand({
        TableName: TABLES.ORGANIZATIONS,
        Key: { orgId: invitation.orgId },
        ProjectionExpression: 'orgName, orgType',
      }));
      if (orgResult.Item?.orgName) orgName = orgResult.Item.orgName;
    } catch {
      // Use orgId as fallback
    }

    return res.status(200).json({
      valid: true,
      email: invitation.email,
      orgName,
      orgType: invitation.orgType || 'vendor',
      roleName: invitation.roleName,
      invitedBy: invitation.invitedBy,
      expiresAt: invitation.expiresAt,
    });
  } catch (error) {
    console.error('[RBAC] validateInviteToken error:', error);
    return res.status(500).json({ valid: false, error: 'Failed to validate invitation' });
  }
}

// ──────────────────────────────────────
// POST /api/rbac/invite/accept
// Public endpoint — no auth required. Creates Cognito user, activates member.
//
// Body: { token, password, displayName }
// ──────────────────────────────────────

/**
 * Accept an invitation: create Cognito user, activate member, mark invitation complete.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function acceptInvitation(req, res) {
  try {
    const { token, password, displayName } = req.body;

    // ── Validation ──
    if (!token || !password || !displayName) {
      return res.status(400).json({
        error: 'token, password, and displayName are required',
      });
    }

    // Password strength: min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character',
      });
    }

    if (displayName.trim().length < 2) {
      return res.status(400).json({ error: 'Display name must be at least 2 characters' });
    }

    // ── Look up invitation by token ──
    const invResult = await docClient.send(new QueryCommand({
      TableName: TABLES.INVITATIONS,
      IndexName: 'TokenIndex',
      KeyConditionExpression: 'inviteToken = :token',
      ExpressionAttributeValues: { ':token': token },
      Limit: 1,
    }));

    const invitation = invResult.Items?.[0];
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    // ── Status checks ──
    if (invitation.status === 'accepted') {
      return res.status(400).json({ error: 'This invitation has already been accepted' });
    }
    if (invitation.status === 'cancelled') {
      return res.status(400).json({ error: 'This invitation has been cancelled' });
    }
    if (new Date(invitation.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'This invitation has expired' });
    }

    const { email, orgId, orgType, roleId, roleName, inviteId, permissionOverrides, platformAccess } = invitation;

    // ── Step 1: Create Cognito user ──
    let cognitoSub = null;
    try {
      // Create user with a temp password first (Cognito requires this flow)
      const tempPassword = `Temp${crypto.randomUUID().slice(0, 8)}!1`;
      const createResult = await cognitoClient.send(new AdminCreateUserCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: displayName.trim() },
        ],
        TemporaryPassword: tempPassword,
        MessageAction: 'SUPPRESS', // We handle email ourselves
      }));

      cognitoSub = createResult.User?.Attributes?.find(a => a.Name === 'sub')?.Value;

      // Immediately set the user's chosen password as permanent
      await cognitoClient.send(new AdminSetUserPasswordCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: email,
        Password: password,
        Permanent: true,
      }));

      console.log(`[RBAC] Cognito user created for ${email} (sub: ${cognitoSub})`);
    } catch (cognitoError) {
      // If user already exists, retrieve their Cognito sub and set the password
      if (cognitoError.name === 'UsernameExistsException') {
        console.log(`[RBAC] Cognito user ${email} already exists — fetching sub and setting password`);
        try {
          // Fetch the existing user's sub so the member record uses the real Cognito sub
          const { AdminGetUserCommand } = await import('@aws-sdk/client-cognito-identity-provider');
          const existingCognitoUser = await cognitoClient.send(new AdminGetUserCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            Username: email,
          }));
          cognitoSub = existingCognitoUser.UserAttributes?.find(a => a.Name === 'sub')?.Value;
          console.log(`[RBAC] Retrieved existing Cognito sub for ${email}: ${cognitoSub}`);

          await cognitoClient.send(new AdminSetUserPasswordCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            Username: email,
            Password: password,
            Permanent: true,
          }));
        } catch (pwError) {
          console.error(`[RBAC] Failed to set password for existing user ${email}:`, pwError.message);
          return res.status(500).json({ error: 'Failed to set up account credentials' });
        }
      } else {
        console.error(`[RBAC] Cognito user creation failed for ${email}:`, cognitoError.message);
        return res.status(500).json({ error: 'Failed to create account' });
      }
    }

    // ── Step 2: Activate the member record ──
    // Delete the pending_* placeholder and create the real member record
    const now = new Date().toISOString();
    const userId = cognitoSub || `user_${crypto.randomUUID()}`;

    // Remove pending placeholder
    try {
      const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
      await docClient.send(new DeleteCommand({
        TableName: TABLES.MEMBERS,
        Key: { orgId, userId: `pending_${inviteId}` },
      }));
    } catch {
      // Pending record might not exist — that's okay
    }

    // Create active member record
    const memberRecord = {
      orgId,
      userId,
      email,
      displayName: displayName.trim(),
      roleId,
      roleName,
      orgType: orgType || 'vendor',
      status: 'active',
      inviteId,
      platformAccess: platformAccess || [orgType || 'vendor'],
      ...(permissionOverrides && { permissionOverrides }),
      joinedAt: now,
      updatedAt: now,
    };

    await docClient.send(new PutCommand({
      TableName: TABLES.MEMBERS,
      Item: memberRecord,
    }));

    // ── Step 3: Create record in the global `users` table ──
    // Team members do NOT get their own vendor/client records.
    // They share the org's vendorId/clientId and are identified by their
    // rbac_members record (orgId + userId).  The users table record ensures
    // /api/auth/verify recognises them and skips role-selection & onboarding.
    await createUsersTableRecord(orgId, orgType, email, displayName.trim(), userId);

    // ── Step 4: Mark invitation as accepted ──
    await docClient.send(new UpdateCommand({
      TableName: TABLES.INVITATIONS,
      Key: { inviteId },
      UpdateExpression: 'SET #s = :accepted, acceptedAt = :now, acceptedBy = :userId',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':accepted': 'accepted',
        ':now': now,
        ':userId': userId,
      },
    }));

    // ── Step 5: Audit log ──
    await logAudit(orgId, userId, 'INVITATION_ACCEPTED', {
      inviteId,
      email,
      roleId,
      displayName: displayName.trim(),
    }, email);

    console.log(`[RBAC] Invitation accepted — ${email} joined ${orgId} as ${roleName}`);

    return res.status(200).json({
      success: true,
      message: `Welcome to the team! You've been added as ${roleName}.`,
      orgType,
      email,
    });
  } catch (error) {
    console.error('[RBAC] acceptInvitation error:', error);
    return res.status(500).json({ error: 'Failed to accept invitation' });
  }
}

// ──────────────────────────────────────
// HELPERS
// ──────────────────────────────────────

/**
 * Create a record in the global `users` table for the team member.
 *
 * This ensures:
 * 1. /api/auth/verify returns roleSelected: true → skip role-selection screen
 * 2. lastSelectedRole is set → correct platform routing
 * 3. isTeamMember + parentOrgId are stored → middleware can identify team members
 *
 * Team members do NOT get their own vendor/client table records.
 * They share the org's vendorId/clientId and are identified via their
 * rbac_members record (orgId = vendorId/clientId, userId = Cognito sub).
 */
async function createUsersTableRecord(orgId, orgType, email, displayName, userId) {
  try {
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    const { v4: uuidv4 } = await import('uuid');
    const USERS_TABLE = EXISTING_TABLES.USERS;
    const now = new Date().toISOString();

    // Check if a users table record already exists for this email.
    // Full Scan (no Limit) so we reliably find the record regardless of table size.
    const existingResult = await docClient.send(new ScanCommand({
      TableName: USERS_TABLE,
      FilterExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email.toLowerCase().trim() },
      ProjectionExpression: 'userId, id, roleSelected, isTeamMember',
    }));

    const existingUser = existingResult.Items?.[0];

    if (existingUser) {
      // User record exists — update it to mark as team member with correct role.
      // Table PK is 'id' (not 'userId').
      const existingId = existingUser.id || existingUser.userId;
      if (existingId) {
        await docClient.send(new UpdateCommand({
          TableName: USERS_TABLE,
          Key: { id: existingId },
          UpdateExpression: 'SET #rs = :rs, lastSelectedRole = :lsr, lastSelectedRoleUpdatedAt = :now, isTeamMember = :tm, parentOrgId = :org, updatedAt = :now',
          ExpressionAttributeNames: { '#rs': 'roleSelected' },
          ExpressionAttributeValues: {
            ':rs': true,
            ':lsr': orgType,
            ':now': now,
            ':tm': true,
            ':org': orgId,
          },
        }));
        console.log(`[RBAC] Updated existing users record for team member ${email}`);
      }
    } else {
      // Create new users table record
      const newUserId = uuidv4();
      await docClient.send(new PutCommand({
        TableName: USERS_TABLE,
        Item: {
          userId: newUserId,
          id: newUserId,
          email: email.toLowerCase().trim(),
          displayName: displayName || email.split('@')[0],
          lastSelectedRole: orgType,
          lastSelectedRoleUpdatedAt: now,
          status: 'active',
          hasFilledForm: true,
          roleSelected: true,
          isTeamMember: true,
          parentOrgId: orgId,
          hasPasskey: false,
          passkeyRegisteredAt: null,
          createdAt: now,
          updatedAt: now,
        },
      }));
      console.log(`[RBAC] Created users table record for team member ${email}`);
    }
  } catch (error) {
    // Log but don't fail the invitation — users record can be patched later
    console.warn(`[RBAC] createUsersTableRecord warning for ${email}:`, error.message);
  }
}

/**
 * Log an audit event. Fire-and-forget.
 */
async function logAudit(orgId, userId, action, details = {}, actorEmail = null) {
  try {
    const item = {
      orgId,
      eventId: `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
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
    console.error('[RBAC] Audit log error:', error?.message);
  }
}
