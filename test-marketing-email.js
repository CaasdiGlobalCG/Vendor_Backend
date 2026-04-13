/**
 * Smoke test: send a newsletter + daily promotion email to a test address.
 * Usage:  node test-marketing-email.js
 */

import 'dotenv/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { buildPromotionsEmail, buildNewsletterEmail } from './modules/vendor/services/marketingEmailTemplates.js';

const TO = 'dhanush@caasdiglobal.in';
const FROM = process.env.SES_FROM_EMAIL || 'noreply@caasdiglobal.in';
const ses = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });

async function send(subject, html) {
  const cmd = new SendEmailCommand({
    Source: `Caasdi <${FROM}>`,
    Destination: { ToAddresses: [TO] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Html: { Data: html, Charset: 'UTF-8' } },
    },
  });
  const res = await ses.send(cmd);
  console.log(`  ✅ Sent — MessageId: ${res.MessageId}`);
}

const dummyUnsub = 'https://api.caasdiglobal.in/api/vendor/unsubscribe?token=test';
const frontendUrl = 'https://www.caasdiglobal.in';

async function main() {
  console.log(`\n📧 Sending test emails to ${TO}\n`);

  // 1. Daily Promotions
  console.log('1️⃣  Daily Promotions…');
  const promoHtml = buildPromotionsEmail({
    name: 'Dhanush',
    unsubscribeUrl: dummyUnsub,
    frontendUrl,
  });
  await send('🔥 Today\'s Top Deals & Opportunities — Caasdi', promoHtml);

  // 2. Weekly Newsletter
  console.log('2️⃣  Weekly Newsletter…');
  const newsHtml = buildNewsletterEmail({
    name: 'Dhanush',
    unsubscribeUrl: dummyUnsub,
    frontendUrl,
  });
  await send('📰 Your Weekly Roundup — Caasdi', newsHtml);

  console.log('\n✅ Done — check your inbox!\n');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
