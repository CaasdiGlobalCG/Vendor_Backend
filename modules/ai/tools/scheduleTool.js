// ============================================================
// FILE: modules/ai/tools/scheduleTool.js
// PURPOSE: LangChain tools that let the AI agent manage
//          scheduled reports and deadline reminders for the
//          authenticated vendor.
// ============================================================

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  createSchedule,
  listSchedules,
  deleteSchedule,
  updateSchedule,
  parseScheduleFromNL,
  ALLOWED_SCOPES,
} from '../services/schedulerService.js';

/**
 * Build schedule management tools scoped to a vendorId.
 * @param {string} vendorId
 * @param {string} vendorEmail - vendor's email for sending reports
 */
export function createScheduleTools(vendorId, vendorEmail) {
  // ── 1. Create schedule from natural language ──
  const createScheduleFromText = new DynamicStructuredTool({
    name: 'createScheduleFromText',
    description:
      'Create a scheduled report or deadline reminder from a natural language description. ' +
      'Use this when the user says things like "Send me a finance summary every Monday", ' +
      '"Remind me about invoice INV-001 due on March 15", or "Set a weekly task report". ' +
      'Supported scopes: quotation, invoice, payment, workspace_task, project, purchase_order, credit_note, subscription, lead, finance_summary, dashboard_summary.',
    schema: z.object({
      text: z.string().describe('The user\'s natural language schedule/reminder request'),
    }),
    func: async ({ text }) => {
      try {
        const parsed = parseScheduleFromNL(text);
        const schedule = await createSchedule({
          vendorId,
          vendorEmail,
          ...parsed,
        });

        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const details = [];
        details.push(`Type: ${schedule.type}`);
        details.push(`Title: ${schedule.title}`);
        details.push(`Scope: ${schedule.scope.replace(/_/g, ' ')}`);
        details.push(`Recurrence: ${schedule.recurrence}`);
        if (schedule.dayOfWeek !== null) details.push(`Day: ${dayNames[schedule.dayOfWeek]}`);
        details.push(`Time: ${schedule.timeOfDay}`);
        if (schedule.dueDate) details.push(`Due date: ${schedule.dueDate}`);
        if (schedule.entityId) details.push(`Entity: ${schedule.entityId}`);
        details.push(`Next run: ${new Date(schedule.nextRunAt).toLocaleString()}`);
        details.push(`Email: ${vendorEmail || 'Not set'}`);

        return `✅ Schedule created successfully!\n${details.join('\n')}`;
      } catch (err) {
        return `❌ Failed to create schedule: ${err.message}`;
      }
    },
  });

  // ── 2. List schedules ──
  const listVendorSchedules = new DynamicStructuredTool({
    name: 'listSchedules',
    description:
      'List all scheduled reports and reminders for this vendor. ' +
      'Can filter by type: "report" for recurring reports, "reminder" for deadline reminders, or "all" for both.',
    schema: z.object({
      type: z.string().optional().describe('Filter: "report", "reminder", or "all" (default)'),
    }),
    func: async ({ type }) => {
      try {
        const filterType = type === 'all' ? undefined : type;
        const schedules = await listSchedules(vendorId, { type: filterType });

        if (schedules.length === 0) {
          return 'No scheduled reports or reminders found. You can create one by saying something like "Send me a finance summary every Monday".';
        }

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const lines = schedules.map((s, i) => {
          const status = s.enabled ? '🟢 Active' : '⏸️ Paused';
          const freq = s.recurrence === 'once' ? 'One-time' : s.recurrence;
          const day = s.dayOfWeek !== null ? dayNames[s.dayOfWeek] : '';
          const nextRun = s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : 'N/A';
          return `${i + 1}. ${s.title} [${status}]\n   Type: ${s.type} | Scope: ${s.scope.replace(/_/g, ' ')} | ${freq}${day ? ' (' + day + ')' : ''} at ${s.timeOfDay}\n   Next: ${nextRun}${s.dueDate ? ' | Due: ' + s.dueDate : ''}\n   ID: ${s.scheduleId}`;
        });

        return `Found ${schedules.length} schedule(s):\n\n${lines.join('\n\n')}`;
      } catch (err) {
        return `❌ Failed to list schedules: ${err.message}`;
      }
    },
  });

  // ── 3. Delete a schedule ──
  const deleteVendorSchedule = new DynamicStructuredTool({
    name: 'deleteSchedule',
    description:
      'Delete a scheduled report or reminder by its schedule ID. Use listSchedules first to find the ID.',
    schema: z.object({
      scheduleId: z.string().describe('The schedule ID to delete'),
    }),
    func: async ({ scheduleId }) => {
      try {
        await deleteSchedule(vendorId, scheduleId);
        return `✅ Schedule ${scheduleId} has been deleted.`;
      } catch (err) {
        return `❌ Failed to delete schedule: ${err.message}`;
      }
    },
  });

  // ── 4. Toggle a schedule ──
  const toggleVendorSchedule = new DynamicStructuredTool({
    name: 'toggleSchedule',
    description:
      'Enable or disable a scheduled report/reminder. Provide the schedule ID and whether to enable (true) or disable (false).',
    schema: z.object({
      scheduleId: z.string().describe('The schedule ID to toggle'),
      enabled: z.boolean().describe('true to enable, false to disable/pause'),
    }),
    func: async ({ scheduleId, enabled }) => {
      try {
        const updated = await updateSchedule(vendorId, scheduleId, { enabled });
        if (!updated) return '❌ Schedule not found.';
        return `✅ Schedule "${updated.title}" is now ${enabled ? 'enabled 🟢' : 'paused ⏸️'}.`;
      } catch (err) {
        return `❌ Failed to toggle schedule: ${err.message}`;
      }
    },
  });

  return [createScheduleFromText, listVendorSchedules, deleteVendorSchedule, toggleVendorSchedule];
}
