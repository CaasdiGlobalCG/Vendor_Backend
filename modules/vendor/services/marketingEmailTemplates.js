// ============================================================
// FILE: marketingEmailTemplates.js
// PURPOSE: Responsive HTML email templates for marketing emails.
//          All templates include unsubscribe links for compliance.
// ============================================================

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function baseWrapper(content, { unsubscribeUrl, preheader = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Caasdi</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f7f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>` : ''}
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f7f6;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0a2e26 0%,#0d3f33 50%,#0f766e 100%);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Caasdi</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 24px;">
            ${content}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px 32px;border-top:1px solid #e5e7eb;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="text-align:center;">
                  <p style="margin:0 0 12px;font-size:12px;color:#9ca3af;">You received this because you're registered on Caasdi.</p>
                  ${unsubscribeUrl ? `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;font-size:12px;text-decoration:underline;">Unsubscribe from these emails</a>` : ''}
                  <p style="margin:12px 0 0;font-size:11px;color:#d1d5db;">&copy; ${new Date().getFullYear()} Caasdi Global. All rights reserved.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Daily Promotions & Deals email.
 */
export function buildPromotionsEmail({ name, unsubscribeUrl, frontendUrl }) {
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Hey ${escapeHtml(name)} 👋</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">${today}</p>

    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.7;">
      Here are today's top opportunities and deals curated for your business:
    </p>

    <!-- Deal Cards -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
      <tr>
        <td style="padding:16px 20px;background-color:#f0fdf4;border-radius:12px;border-left:4px solid #10b981;">
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#059669;text-transform:uppercase;letter-spacing:0.5px;">🏗️ New Tender Opportunities</p>
          <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">Fresh tenders matching your services have been posted. Don't miss the deadline!</p>
        </td>
      </tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
      <tr>
        <td style="padding:16px 20px;background-color:#eff6ff;border-radius:12px;border-left:4px solid #3b82f6;">
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#2563eb;text-transform:uppercase;letter-spacing:0.5px;">📊 Market Insights</p>
          <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">Check out the latest procurement trends and pricing updates in your industry.</p>
        </td>
      </tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
      <tr>
        <td style="padding:16px 20px;background-color:#fef3c7;border-radius:12px;border-left:4px solid #f59e0b;">
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.5px;">⭐ Featured Deals</p>
          <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">Exclusive promotions available for a limited time. Boost your visibility today.</p>
        </td>
      </tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center">
          <a href="${escapeHtml(frontendUrl)}/VendorDashboard" style="display:inline-block;padding:12px 32px;background-color:#0f766e;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
            View Your Dashboard →
          </a>
        </td>
      </tr>
    </table>
  `;

  return baseWrapper(content, { unsubscribeUrl, preheader: 'Today\'s deals and opportunities on Caasdi' });
}

/**
 * Weekly Newsletter email (sent on Mondays).
 */
export function buildNewsletterEmail({ name, unsubscribeUrl, frontendUrl }) {
  const weekOf = new Date().toLocaleDateString('en-IN', { month: 'long', day: 'numeric', year: 'numeric' });

  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Weekly Roundup 📰</h2>
    <p style="margin:0 0 4px;color:#6b7280;font-size:14px;">Hi ${escapeHtml(name)}, here's your Monday briefing</p>
    <p style="margin:0 0 24px;color:#9ca3af;font-size:13px;">Week of ${weekOf}</p>

    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.7;">
      Stay ahead with this week's industry insights, sourcing tips, and platform highlights.
    </p>

    <!-- Section: Industry Insights -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px;">
      <tr>
        <td style="padding:20px;background-color:#f8fafc;border-radius:12px;">
          <h3 style="margin:0 0 8px;color:#0f766e;font-size:16px;font-weight:700;">🔍 Industry Insights</h3>
          <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.7;">
            Stay updated with the latest procurement industry trends, regulatory changes, and market movements that could impact your business.
          </p>
        </td>
      </tr>
    </table>

    <!-- Section: Sourcing Tips -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px;">
      <tr>
        <td style="padding:20px;background-color:#f8fafc;border-radius:12px;">
          <h3 style="margin:0 0 8px;color:#0f766e;font-size:16px;font-weight:700;">💡 Sourcing Tips</h3>
          <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.7;">
            Practical advice on improving your vendor profile, winning more bids, and optimizing your quotation strategy.
          </p>
        </td>
      </tr>
    </table>

    <!-- Section: Platform Highlights -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
      <tr>
        <td style="padding:20px;background-color:#f8fafc;border-radius:12px;">
          <h3 style="margin:0 0 8px;color:#0f766e;font-size:16px;font-weight:700;">📈 Your Week at a Glance</h3>
          <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.7;">
            Review your activity, check new leads, and see how your projects are progressing on Caasdi.
          </p>
        </td>
      </tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center">
          <a href="${escapeHtml(frontendUrl)}/VendorDashboard" style="display:inline-block;padding:12px 32px;background-color:#0f766e;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
            Open Dashboard →
          </a>
        </td>
      </tr>
    </table>
  `;

  return baseWrapper(content, { unsubscribeUrl, preheader: `Your weekly Caasdi roundup — ${weekOf}` });
}

/**
 * Product & Platform Update email (triggered on production deployment).
 *
 * @param {object} opts
 * @param {string} opts.name           – Vendor's first name
 * @param {string} opts.title          – Release title, e.g. "March 2026 Update"
 * @param {Array<{title:string, description:string}>} opts.features – List of features
 * @param {string} [opts.version]      – Optional version string
 * @param {string} opts.unsubscribeUrl
 * @param {string} opts.frontendUrl
 */
export function buildProductUpdateEmail({ name, title, features = [], version, unsubscribeUrl, frontendUrl }) {
  const featureRows = features
    .map(
      (f) => `
      <tr>
        <td style="padding:14px 20px;border-bottom:1px solid #f3f4f6;">
          <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#111827;">✅ ${escapeHtml(f.title)}</p>
          <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">${escapeHtml(f.description)}</p>
        </td>
      </tr>`
    )
    .join('');

  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">What's New on Caasdi 🚀</h2>
    <p style="margin:0 0 4px;color:#6b7280;font-size:14px;">Hi ${escapeHtml(name)}, we've shipped new improvements!</p>
    ${version ? `<p style="margin:0 0 24px;color:#9ca3af;font-size:12px;">Version ${escapeHtml(version)}</p>` : '<div style="margin-bottom:24px;"></div>'}

    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.7;">
      <strong>${escapeHtml(title)}</strong> — Here's what we've added to make your experience better:
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;background-color:#f8fafc;border-radius:12px;overflow:hidden;">
      ${featureRows || `
      <tr>
        <td style="padding:20px;text-align:center;">
          <p style="margin:0;color:#6b7280;font-size:14px;">Several improvements and bug fixes to enhance your experience.</p>
        </td>
      </tr>`}
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center">
          <a href="${escapeHtml(frontendUrl)}/VendorDashboard" style="display:inline-block;padding:12px 32px;background-color:#0f766e;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
            Try It Now →
          </a>
        </td>
      </tr>
    </table>
  `;

  return baseWrapper(content, { unsubscribeUrl, preheader: `${title} — New features on Caasdi` });
}
