import express from 'express';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const router = express.Router();

const SES_REGION = process.env.AWS_REGION || 'ap-south-1';
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@caasdiglobal.in';
const sesClient = new SESClient({ region: SES_REGION });

const PERMISSION_LABELS = {
  view: 'View only',
  edit: 'Can edit',
  anyone_edit: 'Anyone with the link can edit',
};

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildInviteLink = (workspaceLink, email) => {
  const separator = workspaceLink.includes('?') ? '&' : '?';
  return `${workspaceLink}${separator}invite=${encodeURIComponent(email)}`;
};

router.post('/send-progress-email', async (req, res) => {
  const { emails, workspaceLink, note, permission, senderName, workspaceName } = req.body || {};
  if (!Array.isArray(emails) || emails.length === 0 || !workspaceLink) {
    return res.status(400).json({ success: false, message: 'Missing emails or workspace link.' });
  }

  const permissionLabel = PERMISSION_LABELS[permission] || 'View only';
  const safeSender = escapeHtml(senderName || 'A project manager');
  const safeWorkspace = escapeHtml(workspaceName || 'a workspace');
  const safeNote = escapeHtml(note || '').trim();
  const subject = `${senderName || 'A project manager'} shared "${workspaceName || 'a workspace'}" workspace progress with you`;

  const results = await Promise.allSettled(
    emails.map((email) => {
      const inviteLink = buildInviteLink(workspaceLink, email);
      return sesClient.send(new SendEmailCommand({
        Source: `Caasdi <${SES_FROM_EMAIL}>`,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Text: {
              Data: `${senderName || 'A project manager'} shared "${workspaceName || 'a workspace'}" with you (${permissionLabel}).${safeNote ? `\n\nNote: ${note}` : ''}\n\nOpen the workspace: ${inviteLink}`,
              Charset: 'UTF-8',
            },
            Html: {
              Data: `
                <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
                  <div style="background:#4f46e5;padding:20px 24px">
                    <h2 style="color:#fff;margin:0;font-size:18px">Workspace shared with you</h2>
                  </div>
                  <div style="padding:24px">
                    <p style="margin:0 0 12px;color:#374151;font-size:14px">
                      <strong>${safeSender}</strong> shared progress for
                      <strong>${safeWorkspace}</strong> with you.
                    </p>
                    <p style="margin:0 0 16px;color:#6b7280;font-size:13px">
                      Access level: <strong>${escapeHtml(permissionLabel)}</strong>
                    </p>
                    ${safeNote ? `<div style="margin:0 0 16px;padding:12px 14px;background:#f9fafb;border-left:3px solid #4f46e5;border-radius:6px"><p style="margin:0 0 4px;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.05em">Note</p><p style="margin:0;color:#374151;font-size:13px;white-space:pre-wrap">${safeNote}</p></div>` : ''}
                    <a href="${inviteLink}" style="display:inline-block;padding:10px 20px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">Open Workspace</a>
                    <p style="margin:16px 0 0;color:#9ca3af;font-size:11px;word-break:break-all">${inviteLink}</p>
                  </div>
                </div>`,
              Charset: 'UTF-8',
            },
          },
        },
      }));
    })
  );

  const failures = results
    .map((r, i) => (r.status === 'rejected' ? { email: emails[i], error: r.reason?.message } : null))
    .filter(Boolean);

  if (failures.length === emails.length) {
    console.error('SES send-progress-email: all sends failed:', failures);
    return res.status(500).json({ success: false, message: `Failed to send email: ${failures[0].error}` });
  }

  if (failures.length > 0) {
    console.warn('SES send-progress-email: partial failures:', failures);
    return res.json({ success: true, message: 'Email sent to some recipients.', failures });
  }

  return res.json({ success: true, message: 'Email sent successfully.' });
});

export default router;
