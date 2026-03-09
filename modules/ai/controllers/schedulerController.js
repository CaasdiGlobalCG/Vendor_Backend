// ============================================================
// FILE: modules/ai/controllers/schedulerController.js
// PURPOSE: Express handlers for schedule/reminder CRUD and
//          natural-language schedule creation from the AI chat.
// ============================================================

import {
  createSchedule,
  listSchedules,
  getSchedule,
  updateSchedule,
  deleteSchedule,
  parseScheduleFromNL,
  ALLOWED_SCOPES,
} from '../services/schedulerService.js';

/**
 * POST /api/ai/schedules
 * Create a new scheduled report or reminder.
 * Body: { type, scope, title?, description?, recurrence?, dayOfWeek?, timeOfDay?, dueDate?, entityId?, entityName?, notifyBefore? }
 */
export async function handleCreateSchedule(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });

    const { type, scope, ...rest } = req.body;

    if (!type || !['report', 'reminder'].includes(type)) {
      return res.status(400).json({ success: false, message: 'type must be "report" or "reminder"' });
    }
    if (!scope || !ALLOWED_SCOPES.includes(scope)) {
      return res.status(400).json({ success: false, message: `scope must be one of: ${ALLOWED_SCOPES.join(', ')}` });
    }

    // Get vendor email from auth
    const vendorEmail = req.auth?.email || null;

    const schedule = await createSchedule({
      vendorId,
      vendorEmail,
      type,
      scope,
      ...rest,
    });

    return res.json({ success: true, data: schedule });
  } catch (err) {
    console.error('[Scheduler] Create error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create schedule' });
  }
}

/**
 * POST /api/ai/schedules/from-text
 * Parse a natural language description and create a schedule.
 * Body: { text: "Send me a finance summary every Monday at 9am" }
 */
export async function handleCreateFromText(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });

    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'text is required' });
    }

    const parsed = parseScheduleFromNL(text.trim());
    const vendorEmail = req.auth?.email || null;

    const schedule = await createSchedule({
      vendorId,
      vendorEmail,
      ...parsed,
    });

    return res.json({
      success: true,
      data: schedule,
      parsed, // Include parsed fields so the AI can confirm what was understood
    });
  } catch (err) {
    console.error('[Scheduler] Create-from-text error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create schedule from text' });
  }
}

/**
 * GET /api/ai/schedules
 * List all schedules for the vendor.
 * Query: ?type=report|reminder (optional filter)
 */
export async function handleListSchedules(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });

    const { type } = req.query;
    const schedules = await listSchedules(vendorId, { type: type || undefined });

    return res.json({ success: true, data: schedules });
  } catch (err) {
    console.error('[Scheduler] List error:', err);
    return res.status(500).json({ success: false, message: 'Failed to list schedules' });
  }
}

/**
 * GET /api/ai/schedules/:id
 */
export async function handleGetSchedule(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });

    const schedule = await getSchedule(vendorId, req.params.id);
    if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found' });

    return res.json({ success: true, data: schedule });
  } catch (err) {
    console.error('[Scheduler] Get error:', err);
    return res.status(500).json({ success: false, message: 'Failed to get schedule' });
  }
}

/**
 * PATCH /api/ai/schedules/:id
 * Update a schedule.
 * Body: any of { title, description, recurrence, dayOfWeek, timeOfDay, dueDate, notifyBefore, enabled, scope }
 */
export async function handleUpdateSchedule(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });

    const updated = await updateSchedule(vendorId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, message: 'Schedule not found or nothing to update' });

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[Scheduler] Update error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update schedule' });
  }
}

/**
 * DELETE /api/ai/schedules/:id
 */
export async function handleDeleteSchedule(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });

    await deleteSchedule(vendorId, req.params.id);
    return res.json({ success: true, message: 'Schedule deleted' });
  } catch (err) {
    console.error('[Scheduler] Delete error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete schedule' });
  }
}

/**
 * PATCH /api/ai/schedules/:id/toggle
 * Toggle enabled/disabled.
 */
export async function handleToggleSchedule(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });

    const schedule = await getSchedule(vendorId, req.params.id);
    if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found' });

    const updated = await updateSchedule(vendorId, req.params.id, { enabled: !schedule.enabled });
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[Scheduler] Toggle error:', err);
    return res.status(500).json({ success: false, message: 'Failed to toggle schedule' });
  }
}
