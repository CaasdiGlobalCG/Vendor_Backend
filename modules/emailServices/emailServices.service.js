// ============================================================
// FILE: emailServices.service.js
// PURPOSE: Sends transactional emails via AWS SES. Best-effort —
//          errors are logged but never thrown, so the calling
//          mutation (e.g., create invitation) still succeeds.
// CONNECTS TO: emailServices.config.js (SES config),
//              emailTemplates.utils.js (HTML builders),
//              modules/rbac/controllers/membersController.js (consumer)
// NOTE: SES account is in sandbox mode — recipients must be
//       verified until account is moved out of sandbox
//       (request via AWS console).
// ============================================================

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SES_REGION, SES_FROM_EMAIL, VENDOR_FRONTEND_URL } from './emailServices.config.js';
import { buildInvitationEmail, buildRemovalEmail } from './emailTemplates.utils.js';

// ──────────────────────────────────────
// AWS SES client — singleton
// ──────────────────────────────────────
const sesClient = new SESClient({ region: SES_REGION });

/**
 * Build the invite URL that the recipient will click.
 * Points to Vendor Frontend's public InviteAcceptPage.
 *
 * @param {string} inviteToken – UUID token stored in rbac_invitations
 * @returns {string} Full URL, e.g. https://www.caasdiglobal.in/invite/accept?token=abc123
 */
function buildInviteUrl(inviteToken) {
  return `${VENDOR_FRONTEND_URL}/invite/accept?token=${encodeURIComponent(inviteToken)}`;
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
      Source: `Caasdi <${SES_FROM_EMAIL}>`,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: `You've been invited to join ${orgName} on Caasdi`, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    });

    const result = await sesClient.send(command);
    console.log(`[EmailServices] Invitation sent to ${to} — messageId: ${result.MessageId}`);
    return { success: true, messageId: result.MessageId };
  } catch (error) {
    // Log but don't throw — invitation record already created, email is best-effort
    console.error(`[EmailServices] Failed to send invitation to ${to}:`, error.message);
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
      Source: `Caasdi <${SES_FROM_EMAIL}>`,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: `Your access to ${orgName} has been revoked`, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    });

    const result = await sesClient.send(command);
    console.log(`[EmailServices] Removal notification sent to ${to} — messageId: ${result.MessageId}`);
    return { success: true, messageId: result.MessageId };
  } catch (error) {
    console.error(`[EmailServices] Failed to send removal notification to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}
