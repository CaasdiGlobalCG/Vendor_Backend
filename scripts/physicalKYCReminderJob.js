// FILE: scripts/physicalKYCReminderJob.js
// PURPOSE: Cron job — sends 24hr reminder emails for upcoming physical KYC visits
// CONNECTS TO: config/aws.js, services/physicalKYCEmailService.js

import cron from 'node-cron';
import { dynamoDB, PHYSICAL_KYC_SCHEDULES_TABLE, VENDORS_TABLE } from '../config/aws.js';
import { sendVisitReminderEmail } from '../modules/vendor/services/physicalKYCEmailService.js';

/**
 * Queries schedules whose scheduledDate is tomorrow and status is 'scheduled'.
 */
async function getTomorrowsSchedules() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const result = await dynamoDB.scan({
    TableName: PHYSICAL_KYC_SCHEDULES_TABLE,
    FilterExpression: 'scheduledDate = :date AND #status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':date': tomorrowStr, ':status': 'scheduled' },
  }).promise();

  return result.Items || [];
}

async function runReminderJob() {
  console.log('[ReminderJob] Running physical KYC reminder check...');
  try {
    const schedules = await getTomorrowsSchedules();
    console.log(`[ReminderJob] Found ${schedules.length} visit(s) scheduled for tomorrow.`);

    for (const schedule of schedules) {
      try {
        const vendor = await dynamoDB.get({
          TableName: VENDORS_TABLE,
          Key: { vendorId: schedule.vendorId },
        }).promise();

        if (!vendor.Item) continue;

        const vendorEmail = vendor.Item.email || vendor.Item.vendorDetails?.primaryContactEmail;
        const vendorName = vendor.Item.name || vendor.Item.vendorDetails?.primaryContactName || 'Vendor';
        const portalUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/Auditorapprove`;

        if (vendorEmail) {
          await sendVisitReminderEmail(vendorEmail, vendorName, schedule, portalUrl);
          console.log(`[ReminderJob] Reminder sent to ${vendorEmail} for vendor ${schedule.vendorId}`);
        }
      } catch (err) {
        console.error(`[ReminderJob] Failed for vendor ${schedule.vendorId}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[ReminderJob] Fatal error:', err.message);
  }
}

// Schedule: runs daily at 9 AM
export function initPhysicalKYCReminderJob() {
  cron.schedule('0 9 * * *', runReminderJob, { timezone: 'Asia/Kolkata' });
  console.log('[ReminderJob] Physical KYC reminder job scheduled (daily 9 AM IST).');
}

export { runReminderJob };
