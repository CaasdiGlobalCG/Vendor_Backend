import { sendEmail } from '../../../../Employee_Main/backend/services/emailService.js';

export const shareProgress = async (req, res) => {
  try {
    const { emails, workspaceLink } = req.body;
    if (!Array.isArray(emails) || emails.length === 0 || !workspaceLink) {
      return res.status(400).json({ success: false, message: 'Missing emails or workspace link.' });
    }
    const subject = 'Workspace Progress Shared With You';
    const html = `<p>The vendor has shared a workspace progress link with you:</p><p><a href="${workspaceLink}">${workspaceLink}</a></p>`;
    const results = [];
    for (const email of emails) {
      const result = await sendEmail({
        to: email,
        subject,
        html
      });
      results.push({ email, ...result });
    }
    return res.json({ success: true, results });
  } catch (err) {
    console.error('Error in shareProgress:', err);
    return res.status(500).json({ success: false, message: 'Failed to send emails.' });
  }
};
