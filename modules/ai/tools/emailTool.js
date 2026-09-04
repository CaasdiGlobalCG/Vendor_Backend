// ============================================================
// FILE: modules/ai/tools/emailTool.js
// PURPOSE: LangChain tool that lets the AI agent send emails
//          on behalf of the authenticated vendor using AWS SES.
//          Similar to Mac Spotlight "send message" — user types
//          "send email" and the AI composes & sends it.
// ============================================================

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const sesClient = new SESClient({ region: process.env.SES_REGION || AWS_REGION });

// Verified SES sender — must be a verified identity in AWS SES
const SES_FROM = process.env.SES_FROM_EMAIL || process.env.EMAIL_FROM || 'tech@caasdiglobal.in';

// Default recipient for testing
const DEFAULT_RECIPIENT = 'tech@caasdiglobal.in';

/**
 * Build a clean HTML email template.
 */
function buildEmailHTML({ subject, body, senderName, senderEmail }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0d9488,#14b8a6);padding:24px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:600;">
              ✉️ Message from ${senderName || 'CaaS Vendor'}
            </h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <div style="color:#1e293b;font-size:15px;line-height:1.7;white-space:pre-wrap;">${body}</div>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e2e8f0;background:#f8fafc;">
            <p style="margin:0;color:#64748b;font-size:12px;">
              Sent via <strong style="color:#0d9488;">CaaS Digital Global</strong> AI Assistant
              ${senderEmail ? `<br/>From: ${senderEmail}` : ''}
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Create email sending tools scoped to a vendor.
 * @param {string} vendorId
 * @param {string} vendorEmail - The vendor's email (for reply-to)
 * @param {string} vendorName  - The vendor's display name
 */
export function createEmailTools(vendorId, vendorEmail, vendorName) {
  const sendEmail = new DynamicStructuredTool({
    name: 'sendEmail',
    description:
      'Send an email on behalf of the vendor. Use this when the user says "send email", "send a message", ' +
      '"email to...", "compose email", "mail this to...", or similar. ' +
      'The tool sends the email via AWS SES and returns confirmation. ' +
      'Default recipient for testing is tech@caasdiglobal.in. ' +
      'If the user does not specify a recipient, use the default. ' +
      'If the user does not specify a subject, generate an appropriate one from the message body.',
    schema: z.object({
      to: z.string().describe(
        'Recipient email address. Default: tech@caasdiglobal.in'
      ),
      subject: z.string().describe(
        'Email subject line. If user did not specify, generate a short relevant subject from the message.'
      ),
      body: z.string().describe(
        'The email message body text. This is the main content the user wants to send.'
      ),
    }),
    func: async ({ to, subject, body }) => {
      const recipient = to?.trim() || DEFAULT_RECIPIENT;
      const emailSubject = subject?.trim() || 'Message from CaaS AI Assistant';
      const emailBody = body?.trim();

      if (!emailBody) {
        return JSON.stringify({
          success: false,
          error: 'Email body cannot be empty. Please provide a message to send.',
        });
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(recipient)) {
        return JSON.stringify({
          success: false,
          error: `Invalid email address: "${recipient}". Please provide a valid email.`,
        });
      }

      try {
        const html = buildEmailHTML({
          subject: emailSubject,
          body: emailBody,
          senderName: vendorName || 'CaaS Vendor',
          senderEmail: vendorEmail,
        });

        await sesClient.send(new SendEmailCommand({
          Source: SES_FROM,
          Destination: { ToAddresses: [recipient] },
          ReplyToAddresses: vendorEmail ? [vendorEmail] : [],
          Message: {
            Subject: { Data: emailSubject, Charset: 'UTF-8' },
            Body: { Html: { Data: html, Charset: 'UTF-8' } },
          },
        }));

        console.log(`[EmailTool] Email sent: "${emailSubject}" → ${recipient} (vendor: ${vendorId})`);

        return JSON.stringify({
          success: true,
          message: `Email sent successfully to ${recipient}`,
          details: {
            to: recipient,
            subject: emailSubject,
            sentAt: new Date().toISOString(),
          },
          __action: {
            type: 'EMAIL_SENT',
            to: recipient,
            subject: emailSubject,
          },
        });
      } catch (err) {
        console.error(`[EmailTool] SES send failed:`, err.message);

        // Provide helpful error for common SES issues
        if (err.name === 'MessageRejected' && err.message.includes('not verified')) {
          return JSON.stringify({
            success: false,
            error: `Email delivery failed: The recipient "${recipient}" is not a verified email in AWS SES sandbox mode. For testing, use tech@caasdiglobal.in as the recipient.`,
          });
        }

        return JSON.stringify({
          success: false,
          error: `Failed to send email: ${err.message}`,
        });
      }
    },
  });

  return [sendEmail];
}
