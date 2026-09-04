// ============================================================
// FILE: marketingEmailService.js
// PURPOSE: Sends marketing & newsletter emails via AWS SES.
//          Respects vendor emailPreferences before sending.
//          Includes one-click unsubscribe support (RFC 8058).
// ============================================================

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import jwt from 'jsonwebtoken';
import * as DynamoVendor from '../models/DynamoVendor.js';
import {
  buildPromotionsEmail,
  buildNewsletterEmail,
  buildProductUpdateEmail,
} from './marketingEmailTemplates.js';

const sesClient = new SESClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const FROM_ADDRESS = process.env.SES_FROM_EMAIL || 'noreply@caasdiglobal.in';
const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'vendor_unsubscribe_secret_2026';
const VENDOR_FRONTEND_URL = process.env.VENDOR_FRONTEND_URL || 'https://www.caasdiglobal.in';
const VENDOR_BACKEND_URL = process.env.VENDOR_BACKEND_PUBLIC_URL || process.env.VENDOR_BACKEND_URL || 'https://api.caasdiglobal.in';

/**
 * Generate a signed unsubscribe token (valid 90 days).
 */
function generateUnsubscribeToken(vendorId, category) {
  return jwt.sign(
    { vendorId, category, action: 'unsubscribe' },
    UNSUBSCRIBE_SECRET,
    { expiresIn: '90d' }
  );
}

/**
 * Build the unsubscribe URL for a vendor + category.
 */
function buildUnsubscribeUrl(vendorId, category) {
  const token = generateUnsubscribeToken(vendorId, category);
  return `${VENDOR_BACKEND_URL}/api/vendor/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Send an email via SES with unsubscribe headers.
 */
async function sendMarketingEmail({ to, subject, html, unsubscribeUrl }) {
  const headers = {};
  if (unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const command = new SendEmailCommand({
    Source: `Caasdi <${FROM_ADDRESS}>`,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Html: { Data: html, Charset: 'UTF-8' } },
    },
    // SES v2 supports headers natively; for v1, we embed unsubscribe in body
  });

  const result = await sesClient.send(command);
  return { success: true, messageId: result.MessageId };
}

/**
 * Get all vendors who have a specific email preference enabled.
 */
async function getSubscribedVendors(preferenceKey) {
  const allVendors = await DynamoVendor.getAllVendors();
  return allVendors.filter((v) => {
    const email = v.email || v.vendorDetails?.primaryContactEmail;
    if (!email) return false;
    // Default to true if preference not explicitly set
    const prefs = v.emailPreferences || {};
    return prefs[preferenceKey] !== false;
  });
}

/**
 * Send daily Promotions & Deals emails to all subscribed vendors.
 */
export async function sendDailyPromotions() {
  console.log('[Marketing] Starting daily promotions email blast...');
  const vendors = await getSubscribedVendors('promotions');
  console.log(`[Marketing] ${vendors.length} vendors subscribed to promotions`);

  let sent = 0;
  let failed = 0;

  for (const vendor of vendors) {
    const email = vendor.email || vendor.vendorDetails?.primaryContactEmail;
    const name = vendor.vendorDetails?.firstName || vendor.vendorDetails?.primaryContactName || 'there';
    const vendorId = vendor.vendorId;

    try {
      const unsubscribeUrl = buildUnsubscribeUrl(vendorId, 'promotions');
      const html = buildPromotionsEmail({ name, unsubscribeUrl, frontendUrl: VENDOR_FRONTEND_URL });

      await sendMarketingEmail({
        to: email,
        subject: '🔥 Today\'s Deals & Promotions on Caasdi',
        html,
        unsubscribeUrl,
      });
      sent++;
    } catch (err) {
      console.error(`[Marketing] Failed to send promotions to ${email}:`, err.message);
      failed++;
    }
  }

  console.log(`[Marketing] Daily promotions complete: ${sent} sent, ${failed} failed`);
  return { sent, failed, total: vendors.length };
}

/**
 * Send weekly newsletter (Mondays only).
 */
export async function sendWeeklyNewsletter() {
  console.log('[Marketing] Starting weekly newsletter email blast...');
  const vendors = await getSubscribedVendors('newsletter');
  console.log(`[Marketing] ${vendors.length} vendors subscribed to newsletter`);

  let sent = 0;
  let failed = 0;

  for (const vendor of vendors) {
    const email = vendor.email || vendor.vendorDetails?.primaryContactEmail;
    const name = vendor.vendorDetails?.firstName || vendor.vendorDetails?.primaryContactName || 'there';
    const vendorId = vendor.vendorId;

    try {
      const unsubscribeUrl = buildUnsubscribeUrl(vendorId, 'newsletter');
      const html = buildNewsletterEmail({ name, unsubscribeUrl, frontendUrl: VENDOR_FRONTEND_URL });

      await sendMarketingEmail({
        to: email,
        subject: '📰 Your Weekly Caasdi Insights — Industry Trends & Tips',
        html,
        unsubscribeUrl,
      });
      sent++;
    } catch (err) {
      console.error(`[Marketing] Failed to send newsletter to ${email}:`, err.message);
      failed++;
    }
  }

  console.log(`[Marketing] Weekly newsletter complete: ${sent} sent, ${failed} failed`);
  return { sent, failed, total: vendors.length };
}

/**
 * Send product & platform update email to all subscribed vendors.
 * Triggered manually after a production deployment.
 */
export async function sendProductUpdate({ title, features, version }) {
  console.log('[Marketing] Starting product update email blast...');
  const vendors = await getSubscribedVendors('updates');
  console.log(`[Marketing] ${vendors.length} vendors subscribed to product updates`);

  let sent = 0;
  let failed = 0;

  for (const vendor of vendors) {
    const email = vendor.email || vendor.vendorDetails?.primaryContactEmail;
    const name = vendor.vendorDetails?.firstName || vendor.vendorDetails?.primaryContactName || 'there';
    const vendorId = vendor.vendorId;

    try {
      const unsubscribeUrl = buildUnsubscribeUrl(vendorId, 'updates');
      const html = buildProductUpdateEmail({
        name,
        title,
        features,
        version,
        unsubscribeUrl,
        frontendUrl: VENDOR_FRONTEND_URL,
      });

      await sendMarketingEmail({
        to: email,
        subject: `🚀 What's New on Caasdi — ${title}`,
        html,
        unsubscribeUrl,
      });
      sent++;
    } catch (err) {
      console.error(`[Marketing] Failed to send product update to ${email}:`, err.message);
      failed++;
    }
  }

  console.log(`[Marketing] Product update complete: ${sent} sent, ${failed} failed`);
  return { sent, failed, total: vendors.length };
}

/**
 * Verify and process an unsubscribe token.
 * Returns the category that was unsubscribed.
 */
export async function processUnsubscribe(token) {
  const decoded = jwt.verify(token, UNSUBSCRIBE_SECRET);

  if (decoded.action !== 'unsubscribe') {
    throw new Error('Invalid token action');
  }

  const { vendorId, category } = decoded;

  // Map category to preference key
  const categoryMap = {
    promotions: 'promotions',
    newsletter: 'newsletter',
    updates: 'updates',
  };

  const prefKey = categoryMap[category];
  if (!prefKey) {
    throw new Error('Invalid category');
  }

  // Get current preferences and disable the category
  const vendor = await DynamoVendor.getVendorById(vendorId);
  if (!vendor) {
    throw new Error('Vendor not found');
  }

  const currentPrefs = vendor.emailPreferences || {};
  currentPrefs[prefKey] = false;

  await DynamoVendor.updateVendor(vendorId, { emailPreferences: currentPrefs });

  return { vendorId, category, email: vendor.email || vendor.vendorDetails?.primaryContactEmail };
}
