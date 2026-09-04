// ============================================================
// FILE: modules/ai/services/schedulerService.js
// PURPOSE: Manages scheduled reports and business-deadline
//          reminders for vendors. Data stored in DynamoDB
//          table 'vendor_schedules'. A cron tick checks every
//          minute for due items and triggers email + in-app
//          notifications.
//
// Supported entity scopes (CaaS-only):
//   quotation, invoice, payment, workspace_task, project,
//   purchase_order, credit_note, subscription, lead
// ============================================================

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import cron from 'node-cron';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);

const SCHEDULES_TABLE = process.env.VENDOR_SCHEDULES_TABLE || 'vendor_schedules';

// ── Allowed entity scopes ──
export const ALLOWED_SCOPES = [
  'quotation',
  'invoice',
  'payment',
  'workspace_task',
  'project',
  'purchase_order',
  'credit_note',
  'subscription',
  'lead',
  'finance_summary',
  'dashboard_summary',
];

// ── Schedule types ──
export const SCHEDULE_TYPES = {
  REPORT: 'report',      // Recurring scheduled report
  REMINDER: 'reminder',  // One-time or recurring deadline reminder
};

// ── Recurrence patterns ──
export const RECURRENCE = {
  ONCE: 'once',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  BIWEEKLY: 'biweekly',
  MONTHLY: 'monthly',
};

// Day-of-week map for human → cron (0=Sun, 1=Mon … 6=Sat)
const DAY_MAP = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

// ──────────────────────────────────────────────
// CRUD operations
// ──────────────────────────────────────────────

/**
 * Create a new schedule (report or reminder).
 */
export async function createSchedule({
  vendorId,
  vendorEmail,
  type,        // 'report' | 'reminder'
  scope,       // e.g. 'invoice', 'workspace_task', 'finance_summary'
  title,       // Human-readable title e.g. "Weekly Finance Summary"
  description, // Optional details
  recurrence,  // 'once' | 'daily' | 'weekly' | 'biweekly' | 'monthly'
  dayOfWeek,   // 0-6 (for weekly/biweekly)
  timeOfDay,   // "HH:mm" in 24h format
  dueDate,     // ISO date string for one-time reminders
  entityId,    // Optional: specific entity ID (invoice ID, task ID, etc.)
  entityName,  // Optional: human name of the entity
  notifyBefore, // Optional: minutes before due to notify (e.g. 60, 1440)
  enabled = true,
}) {
  const id = uuidv4();
  const now = new Date().toISOString();

  // Compute nextRunAt
  const nextRunAt = computeNextRun({ recurrence, dayOfWeek, timeOfDay, dueDate, notifyBefore });

  const item = {
    vendorId,
    scheduleId: id,
    vendorEmail: vendorEmail || null,
    type,
    scope,
    title: title || `${type === 'report' ? 'Scheduled Report' : 'Reminder'}: ${scope}`,
    description: description || null,
    recurrence: recurrence || (type === 'reminder' ? 'once' : 'weekly'),
    dayOfWeek: dayOfWeek ?? null,
    timeOfDay: timeOfDay || '09:00',
    dueDate: dueDate || null,
    entityId: entityId || null,
    entityName: entityName || null,
    notifyBefore: notifyBefore ?? (type === 'reminder' ? 60 : 0), // default 1h for reminders
    enabled,
    nextRunAt,
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: SCHEDULES_TABLE, Item: item }));
  console.log(`[Scheduler] Created schedule ${id} for vendor ${vendorId}: ${title}`);
  return item;
}

/**
 * List all schedules for a vendor.
 */
export async function listSchedules(vendorId, { type } = {}) {
  const params = {
    TableName: SCHEDULES_TABLE,
    KeyConditionExpression: 'vendorId = :vid',
    ExpressionAttributeValues: { ':vid': vendorId },
  };

  if (type) {
    params.FilterExpression = '#t = :type';
    params.ExpressionAttributeNames = { '#t': 'type' };
    params.ExpressionAttributeValues[':type'] = type;
  }

  const { Items } = await docClient.send(new QueryCommand(params));
  return (Items || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Get a specific schedule.
 */
export async function getSchedule(vendorId, scheduleId) {
  const params = {
    TableName: SCHEDULES_TABLE,
    KeyConditionExpression: 'vendorId = :vid AND scheduleId = :sid',
    ExpressionAttributeValues: { ':vid': vendorId, ':sid': scheduleId },
  };
  const { Items } = await docClient.send(new QueryCommand(params));
  return Items?.[0] || null;
}

/**
 * Update a schedule (toggle enable, change recurrence, etc.).
 */
export async function updateSchedule(vendorId, scheduleId, updates) {
  const allowed = ['title', 'description', 'recurrence', 'dayOfWeek', 'timeOfDay', 'dueDate', 'notifyBefore', 'enabled', 'scope', 'entityId', 'entityName'];
  const exprs = [];
  const names = {};
  const values = {};

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      const attr = `#${key}`;
      const val = `:${key}`;
      exprs.push(`${attr} = ${val}`);
      names[attr] = key;
      values[val] = updates[key];
    }
  }

  // Always update updatedAt
  exprs.push('#upd = :upd');
  names['#upd'] = 'updatedAt';
  values[':upd'] = new Date().toISOString();

  // Recompute nextRunAt if scheduling fields changed
  if (updates.recurrence || updates.dayOfWeek !== undefined || updates.timeOfDay || updates.dueDate) {
    const schedule = await getSchedule(vendorId, scheduleId);
    const merged = { ...schedule, ...updates };
    const nextRunAt = computeNextRun(merged);
    exprs.push('#nra = :nra');
    names['#nra'] = 'nextRunAt';
    values[':nra'] = nextRunAt;
  }

  if (exprs.length === 1) return null; // nothing to update except updatedAt

  await docClient.send(new UpdateCommand({
    TableName: SCHEDULES_TABLE,
    Key: { vendorId, scheduleId },
    UpdateExpression: `SET ${exprs.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));

  return getSchedule(vendorId, scheduleId);
}

/**
 * Delete a schedule.
 */
export async function deleteSchedule(vendorId, scheduleId) {
  await docClient.send(new DeleteCommand({
    TableName: SCHEDULES_TABLE,
    Key: { vendorId, scheduleId },
  }));
  console.log(`[Scheduler] Deleted schedule ${scheduleId} for vendor ${vendorId}`);
  return true;
}

// ──────────────────────────────────────────────
// Due-check: get all schedules due now
// ──────────────────────────────────────────────

/**
 * Scan for all enabled schedules with nextRunAt <= now.
 * Used by the cron tick.
 */
export async function getDueSchedules() {
  const now = new Date().toISOString();
  const params = {
    TableName: SCHEDULES_TABLE,
    FilterExpression: '#enabled = :true AND #nra <= :now',
    ExpressionAttributeNames: { '#enabled': 'enabled', '#nra': 'nextRunAt' },
    ExpressionAttributeValues: { ':true': true, ':now': now },
  };

  const items = [];
  let lastKey = null;
  do {
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await docClient.send(new ScanCommand(params));
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

/**
 * After processing a due schedule, update lastRunAt and compute nextRunAt.
 * For one-time reminders, disable instead of rescheduling.
 */
export async function markScheduleExecuted(vendorId, scheduleId, schedule) {
  const now = new Date().toISOString();
  const isOneTime = schedule.recurrence === 'once';

  if (isOneTime) {
    // Disable the one-time reminder
    await docClient.send(new UpdateCommand({
      TableName: SCHEDULES_TABLE,
      Key: { vendorId, scheduleId },
      UpdateExpression: 'SET #lr = :now, #enabled = :false, #upd = :now',
      ExpressionAttributeNames: { '#lr': 'lastRunAt', '#enabled': 'enabled', '#upd': 'updatedAt' },
      ExpressionAttributeValues: { ':now': now, ':false': false },
    }));
  } else {
    const nextRunAt = computeNextRun(schedule, true);
    await docClient.send(new UpdateCommand({
      TableName: SCHEDULES_TABLE,
      Key: { vendorId, scheduleId },
      UpdateExpression: 'SET #lr = :now, #nra = :nra, #upd = :now',
      ExpressionAttributeNames: { '#lr': 'lastRunAt', '#nra': 'nextRunAt', '#upd': 'updatedAt' },
      ExpressionAttributeValues: { ':now': now, ':nra': nextRunAt },
    }));
  }
}

// ──────────────────────────────────────────────
// Natural language → schedule parsing
// ──────────────────────────────────────────────

/**
 * Parse a natural language scheduling request into structured params.
 * Examples:
 *   "Send me a finance summary every Monday"
 *   "Remind me about invoice INV-001 due on March 15"
 *   "Weekly workspace task report every Friday at 9am"
 *   "Remind me 2 hours before quotation QT-123 expires"
 */
export function parseScheduleFromNL(text) {
  const lower = text.toLowerCase().trim();
  const result = {
    type: null,
    scope: null,
    recurrence: null,
    dayOfWeek: null,
    timeOfDay: '09:00',
    dueDate: null,
    entityId: null,
    entityName: null,
    notifyBefore: null,
    title: null,
  };

  // ── Detect type ──
  if (/\bremind(er|me)?\b/i.test(lower)) {
    result.type = 'reminder';
  } else if (/\b(send|report|summary|schedule)\b/i.test(lower)) {
    result.type = 'report';
  } else {
    result.type = 'reminder'; // default
  }

  // ── Detect scope ──
  if (/\bfinance\s*(summary|report|overview)?\b/i.test(lower)) {
    result.scope = 'finance_summary';
  } else if (/\bdashboard\s*(summary|report|overview)?\b/i.test(lower)) {
    result.scope = 'dashboard_summary';
  } else if (/\binvoice/i.test(lower)) {
    result.scope = 'invoice';
  } else if (/\bquotation/i.test(lower)) {
    result.scope = 'quotation';
  } else if (/\bpayment/i.test(lower)) {
    result.scope = 'payment';
  } else if (/\b(workspace|task)/i.test(lower)) {
    result.scope = 'workspace_task';
  } else if (/\bproject/i.test(lower)) {
    result.scope = 'project';
  } else if (/\bpurchase.order|PO\b/i.test(lower)) {
    result.scope = 'purchase_order';
  } else if (/\bcredit.note/i.test(lower)) {
    result.scope = 'credit_note';
  } else if (/\bsubscription/i.test(lower)) {
    result.scope = 'subscription';
  } else if (/\blead/i.test(lower)) {
    result.scope = 'lead';
  } else {
    result.scope = 'dashboard_summary'; // fallback
  }

  // ── Detect recurrence ──
  if (/\bevery\s*day\b|\bdaily\b/i.test(lower)) {
    result.recurrence = 'daily';
  } else if (/\bbiweekly\b|\bevery\s*(two|2)\s*weeks?\b|\bfortnightly\b/i.test(lower)) {
    result.recurrence = 'biweekly';
  } else if (/\bmonthly\b|\bevery\s*month\b/i.test(lower)) {
    result.recurrence = 'monthly';
  } else if (/\bweekly\b|\bevery\s*week\b/i.test(lower)) {
    result.recurrence = 'weekly';
  } else if (/\bevery\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i.test(lower)) {
    result.recurrence = 'weekly';
  }

  // ── Detect day of week ──
  const dayMatch = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i);
  if (dayMatch) {
    result.dayOfWeek = DAY_MAP[dayMatch[1].toLowerCase()] ?? null;
  }

  // ── Detect time ──
  const timeMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const mins = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const period = timeMatch[3].toLowerCase();
    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    result.timeOfDay = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  } else {
    const time24 = lower.match(/\bat\s+(\d{1,2}):(\d{2})\b/);
    if (time24) {
      result.timeOfDay = `${String(time24[1]).padStart(2, '0')}:${time24[2]}`;
    }
  }

  // ── Detect due date (for reminders) ──
  // "due on March 15", "by 2026-03-15", "on March 15 2026"
  const datePatterns = [
    /\b(?:due|by|on|before)\s+(\w+\s+\d{1,2}(?:,?\s*\d{4})?)/i,
    /\b(\d{4}-\d{2}-\d{2})\b/,
  ];
  for (const pat of datePatterns) {
    const m = lower.match(pat);
    if (m) {
      const parsed = new Date(m[1]);
      if (!isNaN(parsed.getTime())) {
        result.dueDate = parsed.toISOString().split('T')[0];
        if (!result.recurrence) result.recurrence = 'once';
      }
      break;
    }
  }

  // ── Detect entity references ──
  // e.g. "invoice INV-001", "quotation QT-123"
  const entityMatch = text.match(/\b(INV|QT|PO|CN|SUB|TASK|WS|PROJ|LEAD)[-_]?(\w+)\b/i);
  if (entityMatch) {
    result.entityId = entityMatch[0];
    result.entityName = entityMatch[0];
  }

  // ── Detect "notify before" ──
  const beforeMatch = lower.match(/(\d+)\s*(hour|hr|minute|min|day)s?\s*before/i);
  if (beforeMatch) {
    const num = parseInt(beforeMatch[1], 10);
    const unit = beforeMatch[2].toLowerCase();
    if (unit.startsWith('hour') || unit === 'hr') result.notifyBefore = num * 60;
    else if (unit.startsWith('min')) result.notifyBefore = num;
    else if (unit.startsWith('day')) result.notifyBefore = num * 1440;
  }

  // ── Defaults ──
  if (!result.recurrence) {
    result.recurrence = result.type === 'report' ? 'weekly' : 'once';
  }
  if (result.recurrence === 'weekly' && result.dayOfWeek === null) {
    result.dayOfWeek = 1; // Monday default
  }

  // ── Build title ──
  const scopeLabel = result.scope.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  if (result.type === 'report') {
    const freq = result.recurrence.charAt(0).toUpperCase() + result.recurrence.slice(1);
    result.title = `${freq} ${scopeLabel} Report`;
  } else {
    result.title = `Reminder: ${scopeLabel}${result.entityName ? ` (${result.entityName})` : ''}`;
  }

  return result;
}

// ──────────────────────────────────────────────
// Time computation helpers
// ──────────────────────────────────────────────

/**
 * Compute the next run timestamp for a schedule.
 * @param {boolean} afterNow - If true, always pick a time after now (used after execution).
 */
function computeNextRun({ recurrence, dayOfWeek, timeOfDay, dueDate, notifyBefore }, afterNow = false) {
  const now = new Date();
  const [hours, minutes] = (timeOfDay || '09:00').split(':').map(Number);

  if (recurrence === 'once' && dueDate) {
    const due = new Date(dueDate);
    due.setHours(hours, minutes, 0, 0);
    if (notifyBefore && notifyBefore > 0) {
      due.setMinutes(due.getMinutes() - notifyBefore);
    }
    return due.toISOString();
  }

  if (recurrence === 'daily') {
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    if (next <= now || afterNow) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }

  if (recurrence === 'weekly') {
    const targetDay = dayOfWeek ?? 1; // Monday default
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    const currentDay = next.getDay();
    let daysUntil = (targetDay - currentDay + 7) % 7;
    if (daysUntil === 0 && (next <= now || afterNow)) daysUntil = 7;
    next.setDate(next.getDate() + daysUntil);
    return next.toISOString();
  }

  if (recurrence === 'biweekly') {
    const targetDay = dayOfWeek ?? 1;
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    const currentDay = next.getDay();
    let daysUntil = (targetDay - currentDay + 7) % 7;
    if (daysUntil === 0 && (next <= now || afterNow)) daysUntil = 14;
    else if (afterNow) daysUntil += 7; // skip to next biweekly
    next.setDate(next.getDate() + daysUntil);
    return next.toISOString();
  }

  if (recurrence === 'monthly') {
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    if (next <= now || afterNow) {
      next.setMonth(next.getMonth() + 1);
      next.setDate(1); // first of next month
    }
    return next.toISOString();
  }

  // Fallback: tomorrow 9 AM
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(9, 0, 0, 0);
  return fallback.toISOString();
}

export default {
  createSchedule,
  listSchedules,
  getSchedule,
  updateSchedule,
  deleteSchedule,
  getDueSchedules,
  markScheduleExecuted,
  parseScheduleFromNL,
  ALLOWED_SCOPES,
  SCHEDULE_TYPES,
  RECURRENCE,
};
