// ============================================================
// FILE: emailService.js (Vendor Backend — ESM)
// PURPOSE: Sends RBAC invitation emails via AWS SES.
//          Uses SESClient + SendEmailCommand from @aws-sdk/client-ses.
// CONNECTS TO: membersController.inviteMember, emailTemplates.js
// NOTE: SES must have the sender address verified. Currently
//       virtualspace@caasdiglobal.in is verified; noreply@ pending.
//       In sandbox mode, recipient addresses must also be verified.
// ============================================================

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { buildInvitationEmail, buildRemovalEmail } from './emailTemplates.js';

// ──────────────────────────────────────
// AWS SES client — uses shared AWS credentials from env vars
// (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION)
// ──────────────────────────────────────
const sesClient = new SESClient({ region: process.env.AWS_REGION || 'ap-south-1' });

/** Verified sender address for all RBAC invitation emails */
const DEFAULT_FROM = process.env.SES_FROM_EMAIL || 'noreply@caasdiglobal.in';

/**
 * Build the invite URL that the recipient will click.
 * Points to Vendor Frontend's public InviteAcceptPage.
 *
 * @param {string} inviteToken – UUID token stored in rbac_invitations
 * @returns {string} Full URL, e.g. https://www.caasdiglobal.in/invite/accept?token=abc123
 */
function buildInviteUrl(inviteToken) {
  const baseUrl = (
    process.env.VENDOR_FRONTEND_URL ||
    process.env.VENDOR_DASH ||
    'http://localhost:5173'
  ).replace(/\/+$/, '');

  return `${baseUrl}/invite/accept?token=${encodeURIComponent(inviteToken)}`;
}

/**
 * Send an invitation email to a new team member via AWS SES.
 *
 * @param {Object} params
 * @param {string} params.to            – Recipient email
 * @param {string} params.inviteToken   – Token for the accept link
 * @param {string} params.orgName       – Organization display name
 * @param {string} params.roleName      – Role the invitee will get
 * @param {string} params.inviterName   – Name of the person who invited them
 * @param {string} [params.message]     – Optional personal message from inviter
 * @param {string} [params.orgType]     – 'vendor' | 'client' (for template copy)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export async function sendInvitationEmail({
  to,
  inviteToken,
  orgName,
  roleName,
  inviterName,
  message,
  orgType = 'vendor',
}) {
  try {
    const inviteUrl = buildInviteUrl(inviteToken);
    const html = buildInvitationEmail({
      inviteUrl,
      orgName,
      roleName,
      inviterName,
      message,
      orgType,
    });

    const command = new SendEmailCommand({
      Source: `Caasdi <${DEFAULT_FROM}>`,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: `You've been invited to join ${orgName} on Caasdi`, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    });

    const result = await sesClient.send(command);
    console.log(`[RBAC Email] Invitation sent to ${to} — messageId: ${result.MessageId}`);
    return { success: true, messageId: result.MessageId };
  } catch (error) {
    // Log but don't throw — invitation record already created, email is best-effort
    console.error(`[RBAC Email] Failed to send invitation to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send a removal notification email to a member who was removed from the org.
 *
 * @param {Object} params
 * @param {string} params.to            – Recipient email
 * @param {string} params.orgName       – Organization display name
 * @param {string} params.removedByName – Name of the person who removed them
 * @param {string} params.reason        – Reason for removal
 * @param {string} [params.orgType]     – 'vendor' | 'client'
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export async function sendRemovalEmail({ to, orgName, removedByName, reason, orgType = 'vendor' }) {
  try {
    const html = buildRemovalEmail({ orgName, removedByName, reason, orgType });

    const command = new SendEmailCommand({
      Source: `Caasdi <${DEFAULT_FROM}>`,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: `Your access to ${orgName} has been revoked`, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    });

    const result = await sesClient.send(command);
    console.log(`[RBAC Email] Removal notification sent to ${to} — messageId: ${result.MessageId}`);
    return { success: true, messageId: result.MessageId };
  } catch (error) {
    console.error(`[RBAC Email] Failed to send removal notification to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}
