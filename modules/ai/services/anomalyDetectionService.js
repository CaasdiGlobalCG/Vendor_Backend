// ============================================================
// FILE: modules/ai/services/anomalyDetectionService.js
// PURPOSE: Detects anomalies across vendor data — overdue
//          invoices, stale leads, expiring subscriptions,
//          neglected quotations, etc. Feeds into proactive
//          alerts that the AI pushes to the user via WebSocket.
// ============================================================

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// Table names
const TABLES = {
  invoices: 'workspace_invoices',
  quotations: 'workspace_quotations',
  leads: 'lead_invitations_table',
  subscriptions: 'workspace_subscriptions',
  purchaseOrders: 'workspace_purchase_orders',
};

// How many days thresholds
const THRESHOLDS = {
  invoiceOverdueDays: 7,       // Invoice past due date by 7+ days
  invoiceUpcomingDays: 3,      // Invoice due within next 3 days
  leadStaleDays: 14,           // Lead with no response for 14+ days
  quotationStaleDays: 10,      // Sent quotation with no follow-up for 10+ days
  subscriptionExpiringDays: 7, // Subscription renewal within 7 days
};

/**
 * Scan all anomalies for a specific vendor.
 * Returns an array of alert objects.
 */
export async function detectAnomalies(vendorId) {
  const alerts = [];
  const now = new Date();

  const checks = [
    detectOverdueInvoices(vendorId, now, alerts),
    detectUpcomingInvoices(vendorId, now, alerts),
    detectStaleLeads(vendorId, now, alerts),
    detectStaleQuotations(vendorId, now, alerts),
    detectExpiringSubscriptions(vendorId, now, alerts),
  ];

  await Promise.allSettled(checks);

  // Sort by severity: critical first, then warning, then info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => (severityOrder[a.severity] || 9) - (severityOrder[b.severity] || 9));

  return alerts;
}

// ── Overdue Invoices ──
async function detectOverdueInvoices(vendorId, now, alerts) {
  try {
    const items = await queryByVendor(TABLES.invoices, vendorId);
    for (const inv of items) {
      if (!inv.dueDate) continue;
      const due = new Date(inv.dueDate);
      const daysOverdue = Math.floor((now - due) / (1000 * 60 * 60 * 24));

      if (daysOverdue >= THRESHOLDS.invoiceOverdueDays) {
        const amount = inv.total || inv.grandTotal || 0;
        alerts.push({
          id: `overdue-inv-${inv.invoiceId}`,
          type: 'overdue_invoice',
          severity: daysOverdue >= 30 ? 'critical' : 'warning',
          icon: '🔴',
          title: `Invoice ${inv.invoiceNumber || inv.invoiceId} is ${daysOverdue} days overdue`,
          message: `${inv.customerName ? inv.customerName + ' — ' : ''}₹${Number(amount).toLocaleString('en-IN')} was due on ${due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
          suggestion: `Want me to draft a follow-up email for this overdue invoice?`,
          entityType: 'invoice',
          entityId: inv.invoiceId,
          entityName: inv.invoiceNumber || inv.invoiceId,
          daysOverdue,
          amount,
        });
      }
    }
  } catch (err) {
    console.warn('[AnomalyDetection] Failed to scan overdue invoices:', err.message);
  }
}

// ── Upcoming Invoice Deadlines ──
async function detectUpcomingInvoices(vendorId, now, alerts) {
  try {
    const items = await queryByVendor(TABLES.invoices, vendorId);
    for (const inv of items) {
      if (!inv.dueDate) continue;
      const status = (inv.status || '').toLowerCase();
      if (status === 'paid' || status === 'cancelled') continue;

      const due = new Date(inv.dueDate);
      const daysUntilDue = Math.floor((due - now) / (1000 * 60 * 60 * 24));

      if (daysUntilDue >= 0 && daysUntilDue <= THRESHOLDS.invoiceUpcomingDays) {
        const amount = inv.total || inv.grandTotal || 0;
        alerts.push({
          id: `upcoming-inv-${inv.invoiceId}`,
          type: 'upcoming_invoice',
          severity: 'info',
          icon: '⏰',
          title: `Invoice ${inv.invoiceNumber || inv.invoiceId} due ${daysUntilDue === 0 ? 'today' : `in ${daysUntilDue} day${daysUntilDue > 1 ? 's' : ''}`}`,
          message: `${inv.customerName ? inv.customerName + ' — ' : ''}₹${Number(amount).toLocaleString('en-IN')}`,
          suggestion: `Should I send a payment reminder to ${inv.customerName || 'the client'}?`,
          entityType: 'invoice',
          entityId: inv.invoiceId,
          entityName: inv.invoiceNumber || inv.invoiceId,
          daysUntilDue,
          amount,
        });
      }
    }
  } catch (err) {
    console.warn('[AnomalyDetection] Failed to scan upcoming invoices:', err.message);
  }
}

// ── Stale Leads (no response for X days) ──
async function detectStaleLeads(vendorId, now, alerts) {
  try {
    const items = await scanByVendor(TABLES.leads, vendorId);
    for (const lead of items) {
      const status = (lead.status || '').toLowerCase();
      if (status === 'accepted' || status === 'rejected' || status === 'completed') continue;

      const sentAt = lead.sentAt || lead.createdAt;
      if (!sentAt) continue;

      const sent = new Date(sentAt);
      const daysSinceSent = Math.floor((now - sent) / (1000 * 60 * 60 * 24));

      if (daysSinceSent >= THRESHOLDS.leadStaleDays) {
        alerts.push({
          id: `stale-lead-${lead.leadId}`,
          type: 'stale_lead',
          severity: daysSinceSent >= 30 ? 'warning' : 'info',
          icon: '🎯',
          title: `Lead "${lead.clientName || lead.leadTitle || 'Unknown'}" has been pending for ${daysSinceSent} days`,
          message: `${lead.projectDetails?.name || lead.projectName ? 'Project: ' + (lead.projectDetails?.name || lead.projectName) : 'No project specified'}${lead.estimatedBudget || lead.budget ? ' — Budget: ₹' + Number(lead.estimatedBudget || lead.budget).toLocaleString('en-IN') : ''}`,
          suggestion: `Want me to help you respond to this lead or draft a follow-up?`,
          entityType: 'lead',
          entityId: lead.leadId,
          entityName: lead.clientName || lead.leadTitle || 'Unknown',
          daysSinceSent,
        });
      }
    }
  } catch (err) {
    console.warn('[AnomalyDetection] Failed to scan stale leads:', err.message);
  }
}

// ── Stale Quotations (sent but no movement) ──
async function detectStaleQuotations(vendorId, now, alerts) {
  try {
    const items = await queryByVendor(TABLES.quotations, vendorId);
    for (const q of items) {
      const status = (q.status || '').toLowerCase();
      if (status !== 'sent') continue; // Only check quotations in 'sent' state

      const createdAt = q.createdAt || q.sentAt;
      if (!createdAt) continue;

      const created = new Date(createdAt);
      const daysSinceSent = Math.floor((now - created) / (1000 * 60 * 60 * 24));

      if (daysSinceSent >= THRESHOLDS.quotationStaleDays) {
        const amount = q.total || q.grandTotal || 0;
        alerts.push({
          id: `stale-quote-${q.quotationId}`,
          type: 'stale_quotation',
          severity: 'info',
          icon: '📝',
          title: `Quotation ${q.quotationNumber || q.quotationId} sent ${daysSinceSent} days ago with no response`,
          message: `${q.customerName ? q.customerName + ' — ' : ''}₹${Number(amount).toLocaleString('en-IN')}`,
          suggestion: `Should I draft a follow-up message for this quotation?`,
          entityType: 'quotation',
          entityId: q.quotationId,
          entityName: q.quotationNumber || q.quotationId,
          daysSinceSent,
          amount,
        });
      }
    }
  } catch (err) {
    console.warn('[AnomalyDetection] Failed to scan stale quotations:', err.message);
  }
}

// ── Expiring Subscriptions ──
async function detectExpiringSubscriptions(vendorId, now, alerts) {
  try {
    const items = await queryByVendor(TABLES.subscriptions, vendorId);
    for (const sub of items) {
      const status = (sub.status || '').toLowerCase();
      if (status !== 'active') continue;

      const nextBilling = sub.nextBillingDate;
      if (!nextBilling) continue;

      const billing = new Date(nextBilling);
      const daysUntilBilling = Math.floor((billing - now) / (1000 * 60 * 60 * 24));

      if (daysUntilBilling >= 0 && daysUntilBilling <= THRESHOLDS.subscriptionExpiringDays) {
        alerts.push({
          id: `sub-expiring-${sub.subscriptionId}`,
          type: 'subscription_expiring',
          severity: daysUntilBilling <= 2 ? 'warning' : 'info',
          icon: '🔁',
          title: `Subscription for ${sub.customerName || 'a client'} renews ${daysUntilBilling === 0 ? 'today' : `in ${daysUntilBilling} day${daysUntilBilling > 1 ? 's' : ''}`}`,
          message: `${sub.planName ? sub.planName + ' — ' : ''}₹${Number(sub.amount || 0).toLocaleString('en-IN')} ${sub.billingCycle || 'billing'}`,
          suggestion: `Want me to review this subscription before it renews?`,
          entityType: 'subscription',
          entityId: sub.subscriptionId,
          entityName: sub.customerName || sub.planName || sub.subscriptionId,
          daysUntilBilling,
        });
      }
    }
  } catch (err) {
    console.warn('[AnomalyDetection] Failed to scan expiring subscriptions:', err.message);
  }
}

// ── DynamoDB helpers ──
async function queryByVendor(tableName, vendorId) {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'vendorId = :vid',
        ExpressionAttributeValues: { ':vid': vendorId },
      })
    );
    return result.Items || [];
  } catch (err) {
    // Fallback to scan if Query fails (table might not have vendorId as partition key)
    return scanByVendor(tableName, vendorId);
  }
}

async function scanByVendor(tableName, vendorId) {
  let items = [];
  let lastKey = undefined;
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'vendorId = :vid',
        ExpressionAttributeValues: { ':vid': vendorId },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      })
    );
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
}
