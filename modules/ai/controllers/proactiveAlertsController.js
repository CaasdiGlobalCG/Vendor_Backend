// ============================================================
// FILE: modules/ai/controllers/proactiveAlertsController.js
// PURPOSE: REST endpoint for on-demand proactive alert retrieval.
//          GET /api/ai/alerts — returns current anomalies for
//          the authenticated vendor.
//          POST /api/ai/alerts/dismiss — dismiss a specific alert.
// ============================================================

import { getAlertsForVendor } from '../services/proactiveAlertsCron.js';

// In-memory dismissed alerts (per vendorId)
// In production, persist to DynamoDB if needed
const dismissedAlerts = new Map(); // vendorId -> Set of alert IDs

/**
 * GET /api/ai/alerts
 * Returns current anomalies/proactive alerts for the vendor.
 */
export async function handleGetAlerts(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) {
      return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });
    }

    const alerts = await getAlertsForVendor(vendorId);

    // Filter out dismissed alerts
    const dismissed = dismissedAlerts.get(vendorId) || new Set();
    const activeAlerts = alerts.filter((a) => !dismissed.has(a.id));

    return res.json({
      success: true,
      data: activeAlerts,
      totalFound: alerts.length,
      dismissed: dismissed.size,
    });
  } catch (err) {
    console.error('[ProactiveAlerts] GET /alerts error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch alerts' });
  }
}

/**
 * POST /api/ai/alerts/dismiss
 * Dismiss a specific alert so it doesn't show again.
 * Body: { alertId: string }
 */
export async function handleDismissAlert(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) {
      return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });
    }

    const { alertId } = req.body;
    if (!alertId) {
      return res.status(400).json({ success: false, message: 'alertId is required' });
    }

    if (!dismissedAlerts.has(vendorId)) {
      dismissedAlerts.set(vendorId, new Set());
    }
    dismissedAlerts.get(vendorId).add(alertId);

    // Auto-expire dismissed alerts after 24 hours
    setTimeout(() => {
      const set = dismissedAlerts.get(vendorId);
      if (set) set.delete(alertId);
    }, 24 * 60 * 60 * 1000);

    return res.json({ success: true, message: 'Alert dismissed' });
  } catch (err) {
    console.error('[ProactiveAlerts] POST /alerts/dismiss error:', err);
    return res.status(500).json({ success: false, message: 'Failed to dismiss alert' });
  }
}
