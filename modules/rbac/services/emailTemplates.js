// ============================================================
// FILE: emailTemplates.js
// PURPOSE: HTML email templates for RBAC invitation emails.
//          Responsive, inline-styled for maximum email client compat.
// CONNECTS TO: emailService.js (imports buildInvitationEmail)
// ============================================================

/**
 * Build a responsive HTML invitation email.
 *
 * @param {Object} params
 * @param {string} params.inviteUrl    – Full URL for the CTA button
 * @param {string} params.orgName      – Organization display name
 * @param {string} params.roleName     – Role the invitee will receive
 * @param {string} params.inviterName  – Person who sent the invite
 * @param {string} [params.message]    – Optional personal message
 * @param {string} [params.orgType]    – 'vendor' | 'client'
 * @returns {string} Complete HTML email body
 */
export function buildInvitationEmail({
  inviteUrl,
  orgName,
  roleName,
  inviterName,
  message,
  orgType = 'vendor',
}) {
  // Brand colors by org type
  const brandColor = orgType === 'client' ? '#0d9488' : '#0d9488'; // teal-600
  const brandColorDark = orgType === 'client' ? '#0f766e' : '#0f766e'; // teal-700

  const personalMessage = message
    ? `
      <div style="background-color: #f1f5f9; border-left: 4px solid ${brandColor}; padding: 16px 20px; margin: 24px 0; border-radius: 0 8px 8px 0;">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Message from ${escapeHtml(inviterName)}</p>
        <p style="margin: 0; color: #334155; font-size: 15px; line-height: 1.6; font-style: italic;">"${escapeHtml(message)}"</p>
      </div>`
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited to ${escapeHtml(orgName)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; width: 100%;">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, ${brandColor} 0%, ${brandColorDark} 100%); padding: 32px 40px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.025em;">Caasdi</h1>
              <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">Team Invitation</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color: #ffffff; padding: 40px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">

              <h2 style="margin: 0 0 8px 0; color: #1e293b; font-size: 22px; font-weight: 600;">You're invited!</h2>
              <p style="margin: 0 0 24px 0; color: #475569; font-size: 16px; line-height: 1.6;">
                <strong>${escapeHtml(inviterName)}</strong> has invited you to join
                <strong>${escapeHtml(orgName)}</strong> on Caasdi.
              </p>

              <!-- Role badge -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #f0fdfa; border: 1px solid #ccfbf1; border-radius: 8px; padding: 16px 20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right: 12px; vertical-align: middle;">
                          <div style="width: 40px; height: 40px; background-color: ${brandColor}; border-radius: 50%; text-align: center; line-height: 40px; color: #fff; font-weight: 700; font-size: 18px;">
                            ${escapeHtml(roleName.charAt(0).toUpperCase())}
                          </div>
                        </td>
                        <td style="vertical-align: middle;">
                          <p style="margin: 0; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Your Role</p>
                          <p style="margin: 2px 0 0 0; font-size: 16px; color: #0f766e; font-weight: 600;">${escapeHtml(roleName)}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              ${personalMessage}

              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 32px 0;">
                <tr>
                  <td align="center">
                    <a href="${inviteUrl}" target="_blank" style="display: inline-block; background-color: ${brandColor}; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 14px 40px; border-radius: 8px; letter-spacing: 0.01em;">
                      Accept Invitation &amp; Set Up Your Account
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Link fallback -->
              <p style="margin: 0 0 24px 0; color: #94a3b8; font-size: 13px; text-align: center; word-break: break-all;">
                Or copy this link:<br>
                <a href="${inviteUrl}" style="color: ${brandColor};">${inviteUrl}</a>
              </p>

              <!-- Expiry notice -->
              <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 12px 16px; text-align: center;">
                <p style="margin: 0; color: #92400e; font-size: 13px;">
                  ⏰ This invitation expires in <strong>7 days</strong>. Please accept it before it expires.
                </p>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 40px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; text-align: center;">
              <p style="margin: 0 0 8px 0; color: #94a3b8; font-size: 13px;">
                This email was sent by Caasdi on behalf of ${escapeHtml(orgName)}.
              </p>
              <p style="margin: 0; color: #cbd5e1; font-size: 12px;">
                If you didn't expect this invitation, you can safely ignore this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Escape HTML special characters to prevent XSS in email templates.
 * @param {string} str – Raw string
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
