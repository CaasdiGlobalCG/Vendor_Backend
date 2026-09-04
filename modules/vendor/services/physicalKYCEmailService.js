// FILE: modules/vendor/services/physicalKYCEmailService.js
// PURPOSE: AWS SES email notifications for Physical KYC workflow
// CONNECTS TO: modules/vendor/controllers/physicalKYCController.js,
//              modules/vendor/controllers/auditorTokenController.js

import AWS from 'aws-sdk';

const ses = new AWS.SES({
  region: process.env.AWS_REGION || 'ap-south-1',
  
});

const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@caasdiglobal.com';

/**
 * Base send email helper.
 * @param {string} to
 * @param {string} subject
 * @param {string} htmlBody
 * @param {string} textBody
 * @returns {Promise}
 */
const sendEmail = async (to, subject, htmlBody, textBody) => {
  const params = {
    Source: FROM_EMAIL,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: htmlBody, Charset: 'UTF-8' },
        Text: { Data: textBody, Charset: 'UTF-8' },
      },
    },
  };

  const result = await ses.sendEmail(params).promise();
  console.log(`Email sent to ${to}: MessageId=${result.MessageId}`);
  return result;
};

/**
 * Sends Physical KYC scheduled notification to vendor.
 * @param {string} vendorEmail
 * @param {string} vendorName
 * @param {Object} scheduleData
 * @param {string} portalUrl
 */
export const sendPhysicalKYCScheduledEmail = async (vendorEmail, vendorName, scheduleData, portalUrl) => {
  const subject = 'Physical KYC Verification Scheduled — Action Required';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#0F5848">Physical KYC Verification Scheduled</h2>
      <p>Dear <strong>${vendorName}</strong>,</p>
      <p>Your physical KYC verification has been scheduled. Please ensure all required documents are available at the time of the visit.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Date</td><td style="padding:8px">${scheduleData.scheduledDate}</td></tr>
        <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Time</td><td style="padding:8px">${scheduleData.scheduledTime}</td></tr>
        <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Location</td><td style="padding:8px">${scheduleData.location}</td></tr>
        <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Auditor Contact</td><td style="padding:8px">${scheduleData.auditorName || 'TBA'}</td></tr>
      </table>
      <p>View your full checklist and upload pre-visit documents on your vendor portal:</p>
      <p><a href="${portalUrl}" style="background:#0F5848;color:white;padding:10px 20px;text-decoration:none;border-radius:4px">View Portal</a></p>
      <p style="color:#666;font-size:12px">This is an automated notification from Caasdi Global. Do not reply to this email.</p>
    </div>
  `;
  const text = `Physical KYC Verification Scheduled\n\nDear ${vendorName},\n\nDate: ${scheduleData.scheduledDate}\nTime: ${scheduleData.scheduledTime}\nLocation: ${scheduleData.location}\n\nPortal: ${portalUrl}`;

  return sendEmail(vendorEmail, subject, html, text);
};

/**
 * Sends reminder email 24 hours before visit.
 * @param {string} vendorEmail
 * @param {string} vendorName
 * @param {Object} scheduleData
 * @param {string} portalUrl
 */
export const sendVisitReminderEmail = async (vendorEmail, vendorName, scheduleData, portalUrl) => {
  const subject = 'Reminder: Physical KYC Verification Tomorrow';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#0F5848">Reminder: Physical KYC Visit Tomorrow</h2>
      <p>Dear <strong>${vendorName}</strong>,</p>
      <p>This is a reminder that your physical KYC verification is scheduled for tomorrow.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:8px;background:#fff3cd;font-weight:bold">Date</td><td style="padding:8px">${scheduleData.scheduledDate}</td></tr>
        <tr><td style="padding:8px;background:#fff3cd;font-weight:bold">Time</td><td style="padding:8px">${scheduleData.scheduledTime}</td></tr>
        <tr><td style="padding:8px;background:#fff3cd;font-weight:bold">Location</td><td style="padding:8px">${scheduleData.location}</td></tr>
      </table>
      <p><a href="${portalUrl}" style="background:#0F5848;color:white;padding:10px 20px;text-decoration:none;border-radius:4px">View Checklist</a></p>
    </div>
  `;
  const text = `Reminder: Physical KYC tomorrow\n\nDate: ${scheduleData.scheduledDate}\nTime: ${scheduleData.scheduledTime}\nLocation: ${scheduleData.location}\n\nPortal: ${portalUrl}`;

  return sendEmail(vendorEmail, subject, html, text);
};

/**
 * Sends auditor invite email with secure portal link.
 * @param {string} auditorEmail
 * @param {string} auditorName
 * @param {string} portalUrl - one-time secure link
 */
export const sendAuditorInviteEmail = async (auditorEmail, auditorName, portalUrl) => {
  const subject = 'Physical KYC Audit Assignment — Secure Access Link';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#0F5848">Physical KYC Audit Assignment</h2>
      <p>Dear <strong>${auditorName}</strong>,</p>
      <p>You have been assigned to conduct a physical KYC verification on behalf of Caasdi Global.</p>
      <p>Please use the link below to access the secure auditor portal. You will be required to verify your identity via OTP before accessing vendor details.</p>
      <p style="background:#f0f0f0;padding:12px;border-radius:4px;word-break:break-all">${portalUrl}</p>
      <p><a href="${portalUrl}" style="background:#0F5848;color:white;padding:10px 20px;text-decoration:none;border-radius:4px">Access Auditor Portal</a></p>
      <p style="color:#e53e3e;font-weight:bold">⚠️ This link expires in 7 days and is single-use. Do not share this link.</p>
      <p style="color:#666;font-size:12px">If you did not expect this invitation, please ignore this email and contact Caasdi Global.</p>
    </div>
  `;
  const text = `Physical KYC Audit Assignment\n\nDear ${auditorName},\n\nYou have been assigned to conduct a physical KYC verification.\n\nAccess your portal: ${portalUrl}\n\nThis link expires in 7 days. Do not share this link.`;

  return sendEmail(auditorEmail, subject, html, text);
};

/**
 * Sends OTP verification code to auditor email.
 * @param {string} email
 * @param {string} otp
 */
export const sendOTPEmail = async (email, otp) => {
  const subject = 'Your Verification Code — Caasdi Auditor Portal';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#0F5848">Verification Code</h2>
      <p>Your one-time verification code is:</p>
      <p style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#0F5848;text-align:center;background:#f0f9f6;padding:16px;border-radius:8px">${otp}</p>
      <p style="color:#666">This code expires in <strong>10 minutes</strong>.</p>
      <p style="color:#e53e3e;font-size:12px">Never share this code with anyone.</p>
    </div>
  `;
  const text = `Your verification code: ${otp}\n\nThis code expires in 10 minutes.`;

  return sendEmail(email, subject, html, text);
};

/**
 * Notifies vendor of physical KYC result (passed/failed).
 * @param {string} vendorEmail
 * @param {string} vendorName
 * @param {'passed'|'failed'} result
 * @param {string} portalUrl
 */
export const sendKYCResultEmail = async (vendorEmail, vendorName, result, portalUrl) => {
  const passed = result === 'passed';
  const subject = passed
    ? 'Physical KYC Verification Passed — Awaiting Final Approval'
    : 'Physical KYC Verification — Action Required';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:${passed ? '#0F5848' : '#e53e3e'}">${passed ? '✅ Physical KYC Passed' : '❌ Physical KYC — Issues Found'}</h2>
      <p>Dear <strong>${vendorName}</strong>,</p>
      <p>${passed
        ? 'Your physical KYC verification has been completed successfully and is now under compliance review for final approval.'
        : 'The auditor has identified issues during your physical KYC verification. Please log in to your portal to review the findings.'
      }</p>
      <p><a href="${portalUrl}" style="background:#0F5848;color:white;padding:10px 20px;text-decoration:none;border-radius:4px">View Results</a></p>
    </div>
  `;
  const text = `Physical KYC Result: ${result.toUpperCase()}\n\nDear ${vendorName},\n\nView details: ${portalUrl}`;

  return sendEmail(vendorEmail, subject, html, text);
};

/**
 * Notifies vendor of final Compliance Lead decision (approved/rejected).
 * @param {string} vendorEmail
 * @param {string} vendorName
 * @param {'approved'|'rejected'} decision
 * @param {string} [rejectionReason]
 */
export const sendComplianceDecisionEmail = async (vendorEmail, vendorName, decision, rejectionReason) => {
  const approved = decision === 'approved';
  const subject = approved
    ? 'Congratulations! Your Vendor Application is Approved'
    : 'Vendor Application — Compliance Review Decision';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:${approved ? '#0F5848' : '#e53e3e'}">${approved ? '🎉 Application Approved!' : '❌ Application Not Approved'}</h2>
      <p>Dear <strong>${vendorName}</strong>,</p>
      ${approved
        ? '<p>Your vendor application has been fully approved following successful completion of online and physical KYC verification. You can now access the full Caasdi vendor platform.</p>'
        : `<p>After reviewing your physical KYC verification results, our Compliance team has decided not to approve your application at this time.</p>${rejectionReason ? `<p><strong>Reason:</strong> ${rejectionReason}</p>` : ''}<p>If you believe this decision is incorrect, please contact our support team.</p>`
      }
    </div>
  `;
  const text = `Compliance Decision: ${decision.toUpperCase()}\n\nDear ${vendorName},\n\n${approved ? 'Your application has been approved.' : `Your application was not approved.${rejectionReason ? '\nReason: ' + rejectionReason : ''}`}`;

  return sendEmail(vendorEmail, subject, html, text);
};
