import express from 'express';
import nodemailer from 'nodemailer';

const router = express.Router();

const transporter = nodemailer.createTransport({
  host: 'smtp.office365.com', // Outlook SMTP host
  port: 587,
  secure: false, // Use STARTTLS
  auth: {
    user: process.env.EMAIL_USER || 'tech@caasdiglobal.in',
    pass: process.env.EMAIL_PASSWORD,
  },
});

router.post('/send-progress-email', async (req, res) => {
  const { emails, workspaceLink } = req.body;
  if (!Array.isArray(emails) || emails.length === 0 || !workspaceLink) {
    return res.status(400).json({ success: false, message: 'Missing emails or workspace link.' });
  }

  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'tech@caasdiglobal.in', // Outlook shared mailbox
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
