// ============================================================
// FILE: marketingScheduler.js
// PURPOSE: Cron-based scheduler for marketing emails.
//          - Daily promotions at 9 AM IST (3:30 AM UTC)
//          - Weekly newsletter on Mondays at 9 AM IST
// ============================================================

import cron from 'node-cron';
import { sendDailyPromotions, sendWeeklyNewsletter } from './marketingEmailService.js';

/**
 * Initialize all marketing email cron jobs.
 * Call this once from server.js during startup.
 */
export function initializeMarketingScheduler() {
  const marketingEmailsEnabled = String(process.env.ENABLE_MARKETING_EMAILS || '').toLowerCase() === 'true';
  if (!marketingEmailsEnabled) {
    console.warn('[Marketing] Scheduler disabled (set ENABLE_MARKETING_EMAILS=true to enable).');
    return;
  }

  console.log('🔄 Initializing marketing email scheduler...');

  // ── Daily Promotions & Deals ──
  // Runs every day at 9:00 AM IST (3:30 AM UTC)
  cron.schedule('30 3 * * *', async () => {
    console.log('⏰ [Marketing Cron] Running daily promotions...');
    try {
      const result = await sendDailyPromotions();
      console.log(`✅ [Marketing Cron] Daily promotions done:`, result);
    } catch (error) {
      console.error('❌ [Marketing Cron] Daily promotions failed:', error.message);
    }
  }, { timezone: 'UTC' });

  // ── Weekly Newsletter (Mondays only) ──
  // Runs every Monday at 9:00 AM IST (3:30 AM UTC)
  // Cron day-of-week: 1 = Monday
  cron.schedule('30 3 * * 1', async () => {
    console.log('⏰ [Marketing Cron] Running weekly newsletter...');
    try {
      const result = await sendWeeklyNewsletter();
      console.log(`✅ [Marketing Cron] Weekly newsletter done:`, result);
    } catch (error) {
      console.error('❌ [Marketing Cron] Weekly newsletter failed:', error.message);
    }
  }, { timezone: 'UTC' });

  console.log('✅ Marketing scheduler initialized:');
  console.log('   📧 Daily Promotions — every day at 9:00 AM IST');
  console.log('   📰 Weekly Newsletter — every Monday at 9:00 AM IST');
}
