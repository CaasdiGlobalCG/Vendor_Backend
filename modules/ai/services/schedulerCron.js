// ============================================================
// FILE: modules/ai/services/schedulerCron.js
// PURPOSE: Cron job that ticks every minute, checks for due
//          schedules, and dispatches emails + in-app
//          notifications for both reports and reminders.
// ============================================================

import cron from 'node-cron';
import { getDueSchedules, markScheduleExecuted } from './schedulerService.js';
import { sendReportEmail, sendReminderEmail } from './reportEmailService.js';
import { createNotification } from '../../../models/DynamoNotification.js';
import { sendNotificationToUser } from '../../../websocket/notificationSocket.js';

let isRunning = false;

/**
 * Process a single due schedule: send email, create in-app notification,
 * then mark as executed (reschedule or disable).
 */
async function processSchedule(schedule) {
  const { vendorId, scheduleId, type, title, scope, entityName } = schedule;
  console.log(`[SchedulerCron] Processing ${type} "${title}" for vendor ${vendorId}`);

  try {
    // 1. Send email
    if (type === 'report') {
      await sendReportEmail(schedule);
    } else {
      await sendReminderEmail(schedule);
    }

    // 2. Create in-app notification
    const notification = await createNotification({
      userId: vendorId,
      userType: 'vendor',
      type: type === 'report' ? 'scheduled_report' : 'deadline_reminder',
      title: type === 'report' ? `📊 ${title}` : `⏰ ${title}`,
      message: type === 'report'
        ? `Your ${scope.replace(/_/g, ' ')} report is ready. Check your email for details.`
        : `Deadline reminder for ${scope.replace(/_/g, ' ')}${entityName ? `: ${entityName}` : ''}. Please review and take action.`,
      relatedId: schedule.entityId || schedule.scheduleId,
      relatedType: type === 'report' ? 'scheduled_report' : 'deadline_reminder',
    });

    // 3. Push via WebSocket for real-time toast
    sendNotificationToUser(vendorId, {
      ...notification,
      _source: 'scheduler',
    });

    // 4. Mark executed (reschedule or disable one-time)
    await markScheduleExecuted(vendorId, scheduleId, schedule);

    console.log(`[SchedulerCron] ✅ Completed ${type} "${title}" for vendor ${vendorId}`);
  } catch (err) {
    console.error(`[SchedulerCron] ❌ Error processing schedule ${scheduleId}:`, err.message);
    // Still mark as executed to avoid infinite retry loops
    try {
      await markScheduleExecuted(vendorId, scheduleId, schedule);
    } catch (markErr) {
      console.error(`[SchedulerCron] Failed to mark schedule ${scheduleId} as executed:`, markErr.message);
    }
  }
}

/**
 * The main tick function — runs every minute.
 */
async function tick() {
  if (isRunning) return; // prevent overlap
  isRunning = true;

  try {
    const dueSchedules = await getDueSchedules();
    if (dueSchedules.length === 0) {
      isRunning = false;
      return;
    }

    console.log(`[SchedulerCron] Found ${dueSchedules.length} due schedule(s) to process`);

    // Process all due schedules concurrently (with concurrency limit)
    const BATCH_SIZE = 5;
    for (let i = 0; i < dueSchedules.length; i += BATCH_SIZE) {
      const batch = dueSchedules.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(processSchedule));
    }
  } catch (err) {
    console.error('[SchedulerCron] Tick error:', err.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Initialize the scheduler cron job.
 * Runs every minute to check for due schedules.
 */
export function initializeSchedulerCron() {
  // Run every minute
  cron.schedule('* * * * *', tick, {
    scheduled: true,
    timezone: 'Asia/Kolkata', // IST
  });

  console.log('⏰ Scheduler cron initialized — checking every minute for due reports/reminders');
}

export default { initializeSchedulerCron };
