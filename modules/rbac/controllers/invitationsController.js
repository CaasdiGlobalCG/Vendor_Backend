// ============================================================
// FILE: invitationsController.js
// PURPOSE: List and manage pending invitations for an organization.
//          Phase 2: Accept/reject/resend/cancel invitations.
// CONNECTS TO: rbac_invitations table (OrgInvitesIndex GSI)
// ============================================================

import { QueryCommand, UpdateCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';

/**
 * GET /api/rbac/invitations
 * List invitations for the current org.
 * Requires: user_management:view permission.
 *
 * Query params:
 *   - status (optional): 'pending' | 'accepted' | 'expired' | 'cancelled'
 *   - limit (default 50, max 100)
 */
export async function listInvitations(req, res) {
  try {
    const { orgId } = req.rbac;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const statusFilter = req.query.status;

    const params = {
      TableName: TABLES.INVITATIONS,
      IndexName: 'OrgInvitesIndex',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
      Limit: limit,
      ScanIndexForward: false, // newest first
    };

    // Optional status filter
    if (statusFilter) {
      params.FilterExpression = '#s = :status';
      params.ExpressionAttributeNames = { '#s': 'status' };
      params.ExpressionAttributeValues[':status'] = statusFilter;
    }

    const result = await docClient.send(new QueryCommand(params));

    const invitations = (result.Items || []).map((inv) => ({
      inviteId: inv.inviteId,
      email: inv.email,
      roleId: inv.roleId,
      roleName: inv.roleName,
      status: inv.status,
      invitedBy: inv.invitedBy,
      createdAt: inv.createdAt,
      expiresAt: inv.expiresAt,
      // Mark expired invitations that are still 'pending'
      isExpired: inv.status === 'pending' && new Date(inv.expiresAt) < new Date(),
    }));

    return res.status(200).json({
      invitations,
      total: invitations.length,
    });
  } catch (error) {
    console.error('[RBAC] listInvitations error:', error);
    return res.status(500).json({ error: 'Failed to list invitations' });
  }
}

/**
 * DELETE /api/rbac/invitations/:inviteId
 * Cancel a pending invitation.
 * Requires: user_management:edit permission.
 */
export async function cancelInvitation(req, res) {
  try {
    const { orgId, userId: callerId } = req.rbac;
    const { inviteId } = req.params;

    // ── Fetch the invitation ──
    const invResult = await docClient.send(new GetCommand({
      TableName: TABLES.INVITATIONS,
      Key: { inviteId },
    }));

    const invitation = invResult.Item;
    if (!invitation || invitation.orgId !== orgId) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ error: `Cannot cancel invitation with status '${invitation.status}'` });
    }

    // ── Mark invitation as cancelled ──
    await docClient.send(new UpdateCommand({
      TableName: TABLES.INVITATIONS,
      Key: { inviteId },
      UpdateExpression: 'SET #s = :cancelled, cancelledBy = :caller, cancelledAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':cancelled': 'cancelled',
        ':caller': callerId,
        ':now': new Date().toISOString(),
      },
    }));

    // ── Remove the pending member record if it exists ──
    if (invitation.email) {
      try {
        await docClient.send(new DeleteCommand({
          TableName: TABLES.MEMBERS,
          Key: { orgId, userId: `pending_${inviteId}` },
        }));
      } catch {
        // Ignore — pending record might not exist
      }
    }

    return res.status(200).json({
      success: true,
      message: `Invitation to ${invitation.email} has been cancelled`,
    });
  } catch (error) {
    console.error('[RBAC] cancelInvitation error:', error);
    return res.status(500).json({ error: 'Failed to cancel invitation' });
  }
}
