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

    const { email, orgId, orgType, roleId, roleName, inviteId, permissionOverrides } = invitation;

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
      // If user already exists, try to just set the password
      if (cognitoError.name === 'UsernameExistsException') {
        console.log(`[RBAC] Cognito user ${email} already exists — setting password`);
        try {
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
      status: 'active',
      inviteId,
      ...(permissionOverrides && { permissionOverrides }),
      joinedAt: now,
      updatedAt: now,
    };

    await docClient.send(new PutCommand({
      TableName: TABLES.MEMBERS,
      Item: memberRecord,
    }));

    // ── Step 3: Create entity record in platform-specific table ──
    // For vendors → vendors table, for clients → clients table
    // This ensures the user shows up in the platform's user lookup
    await createPlatformRecord(orgId, orgType, email, displayName.trim(), userId);

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
    });

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
 * Create a record in the platform-specific table (vendors / clients).
 * This ensures auth middleware lookups (EmailIndex) resolve the user.
 *
 * - For vendor orgs: checks if vendor record exists; if not, creates a minimal one
 * - For client orgs: checks if client record exists; if not, creates a minimal one
 *
 * NOTE: This does NOT replace onboarding. The user still needs to fill out
 * vendor/client forms. It just ensures auth pipeline resolves their identity.
 */
async function createPlatformRecord(orgId, orgType, email, displayName, userId) {
  try {
    if (orgType === 'vendor') {
      // Check if a vendor record with this email already exists
      const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
      const scanResult = await docClient.send(new ScanCommand({
        TableName: EXISTING_TABLES.VENDORS,
        FilterExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': email },
        Limit: 1,
        ProjectionExpression: 'vendorId',
      }));

      if (!scanResult.Items?.length) {
        // Create minimal vendor record so auth pipeline can resolve vendorId
        await docClient.send(new PutCommand({
          TableName: EXISTING_TABLES.VENDORS,
          Item: {
            vendorId: orgId, // Use the org's vendorId — the member belongs to this vendor org
            email,
            name: displayName,
            status: 'active',
            hasFilledForm: false,
            isTeamMember: true, // Flag to distinguish from org-owner vendors
            parentOrgId: orgId,
            createdAt: new Date().toISOString(),
          },
          // Only create if no record with this email exists (race condition guard)
          ConditionExpression: 'attribute_not_exists(vendorId)',
        }));
        console.log(`[RBAC] Created vendor (team member) record for ${email}`);
      }
    } else if (orgType === 'client') {
      // Check via EmailIndex GSI
      const { QueryCommand: QCmd } = await import('@aws-sdk/lib-dynamodb');
      const clientResult = await docClient.send(new QCmd({
        TableName: EXISTING_TABLES.CLIENTS,
        IndexName: 'EmailIndex',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': email },
        Limit: 1,
        ProjectionExpression: 'clientId',
      }));

      if (!clientResult.Items?.length) {
        const { randomUUID } = await import('crypto');
        await docClient.send(new PutCommand({
          TableName: EXISTING_TABLES.CLIENTS,
          Item: {
            clientId: randomUUID(),
            email,
            contactName: displayName,
            verificationStatus: 'approved', // Team members are pre-approved
            hasOnboarded: false,
            isTeamMember: true,
            parentOrgId: orgId,
            details: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }));
        console.log(`[RBAC] Created client (team member) record for ${email}`);
      }
    }
  } catch (error) {
    // Log but don't fail the invitation — platform record can be created later
    console.warn(`[RBAC] createPlatformRecord warning for ${email}:`, error.message);
  }
}

/**
 * Log an audit event. Fire-and-forget.
 */
async function logAudit(orgId, userId, action, details = {}) {
  try {
    await docClient.send(new PutCommand({
      TableName: TABLES.AUDIT_LOG,
      Item: {
        orgId,
        eventId: `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
        userId,
        action,
        details,
        timestamp: new Date().toISOString(),
      },
    }));
  } catch (error) {
    console.error('[RBAC] Audit log error:', error?.message);
  }
}
