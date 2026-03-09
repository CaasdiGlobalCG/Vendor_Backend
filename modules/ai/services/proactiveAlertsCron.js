// ============================================================
// FILE: modules/ai/services/proactiveAlertsCron.js
// PURPOSE: Cron job that periodically scans vendor data for
//          anomalies and pushes proactive alerts via WebSocket.
//          Runs every 15 minutes during business hours.
// ============================================================

import cron from 'node-cron';
import { detectAnomalies } from './anomalyDetectionService.js';
import { sendNotificationToUser } from '../../../websocket/notificationSocket.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// In-memory cache of recently sent alerts to avoid spamming
// Key: vendorId:alertId → timestamp of last push
const sentAlertsCache = new Map();
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours between repeats of same alert

let isRunning = false;

/**
 * Get all unique vendor IDs from the vendors table.
 */
async function getActiveVendorIds() {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: 'vendors',
        ProjectionExpression: 'vendorId',
      })
    );
    return (result.Items || []).map((v) => v.vendorId).filter(Boolean);
  } catch (err) {
    console.warn('[ProactiveAlerts] Failed to get vendor IDs:', err.message);
    return [];
  }
}

/**
 * Push new alerts to a vendor via WebSocket.
 * Skips alerts that were recently sent (cooldown).
 */
function pushAlertsToVendor(vendorId, alerts) {
  const now = Date.now();
  const newAlerts = [];

  for (const alert of alerts) {
    const cacheKey = `${vendorId}:${alert.id}`;
    const lastSent = sentAlertsCache.get(cacheKey);

    if (!lastSent || now - lastSent > ALERT_COOLDOWN_MS) {
      newAlerts.push(alert);
      sentAlertsCache.set(cacheKey, now);
    }
  }

  if (newAlerts.length === 0) return;

  // Send via WebSocket as a new message type
  sendNotificationToUser(vendorId, {
    type: 'proactive_alert',
    alerts: newAlerts,
    timestamp: new Date().toISOString(),
  });

  console.log(`[ProactiveAlerts] Pushed ${newAlerts.length} alert(s) to vendor ${vendorId}`);
}

/**
 * Main tick — runs periodically.
 */
async function tick() {
  if (isRunning) return;
  isRunning = true;

  try {
    const vendorIds = await getActiveVendorIds();
    if (vendorIds.length === 0) {
      isRunning = false;
      return;
    }

    console.log(`[ProactiveAlerts] Scanning ${vendorIds.length} vendor(s) for anomalies...`);

    // Process vendors in batches to avoid overwhelming DynamoDB
    const BATCH_SIZE = 5;
    for (let i = 0; i < vendorIds.length; i += BATCH_SIZE) {
      const batch = vendorIds.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async (vendorId) => {
          try {
            const alerts = await detectAnomalies(vendorId);
            if (alerts.length > 0) {
              pushAlertsToVendor(vendorId, alerts);
            }
          } catch (err) {
            console.warn(`[ProactiveAlerts] Error for vendor ${vendorId}:`, err.message);
          }
        })
      );
    }

    // Clean up old cache entries (older than 24 hours)
    const cleanupThreshold = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, ts] of sentAlertsCache) {
      if (ts < cleanupThreshold) sentAlertsCache.delete(key);
    }
  } catch (err) {
    console.error('[ProactiveAlerts] Tick error:', err.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Initialize the proactive alerts cron job.
 * Runs every 15 minutes.
 */
export function initializeProactiveAlertsCron() {
  // Every 15 minutes
  cron.schedule('*/15 * * * *', tick, {
    scheduled: true,
    timezone: 'Asia/Kolkata',
  });

  console.log('🔔 Proactive Alerts cron initialized — scanning every 15 min for anomalies');
}

/**
 * Manually trigger anomaly scan for a specific vendor.
 * Used by the REST endpoint for on-demand alerts.
 */
export async function getAlertsForVendor(vendorId) {
  return detectAnomalies(vendorId);
}

export default { initializeProactiveAlertsCron, getAlertsForVendor };
