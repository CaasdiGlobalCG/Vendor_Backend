import express from 'express';
import nodemailer from 'nodemailer';

const router = express.Router();

const transporter = nodemailer.createTransport({
  host: 'smtpout.secureserver.net', // GoDaddy SMTP host
  port: 587,
  secure: false,
  auth: {
    user: 'virtualspace@caasdiglobal.in',
    pass: 'virtualspace@2678',
  },
});

router.post('/send-progress-email', async (req, res) => {
  const { emails, workspaceLink } = req.body;
  if (!Array.isArray(emails) || emails.length === 0 || !workspaceLink) {
    return res.status(400).json({ success: false, message: 'Missing emails or workspace link.' });
  }

  try {
    const mailOptions = {
      from: 'virtualspace@caasdiglobal.in', // GoDaddy domain email
      to: emails.join(','),
      subject: 'Workspace Progress Shared',
      text: `A workspace has been shared with you. Link: ${workspaceLink}`,
      html: `<p>A workspace has been shared with you.</p><p><a href="${workspaceLink}">${workspaceLink}</a></p>`
    };
    await transporter.sendMail(mailOptions);
    return res.json({ success: true, message: 'Email sent successfully.' });
  } catch (err) {
    console.error('Email send error:', err);
    return res.status(500).json({ success: false, message: 'Failed to send email.' });
  }
});

export default router;
