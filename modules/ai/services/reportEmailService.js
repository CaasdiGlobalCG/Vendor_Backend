// ============================================================
// FILE: modules/ai/services/reportEmailService.js
// PURPOSE: Generate and send scheduled report / reminder emails
//          to vendors. Uses AWS SES for email delivery.
//          Also generates report data using existing AI tools.
// ============================================================

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const ddbClient = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// ── AWS SES client ──
const sesClient = new SESClient({ region: process.env.SES_REGION || AWS_REGION });
const SES_FROM = process.env.SES_FROM_EMAIL || process.env.EMAIL_FROM || 'tech@caasdiglobal.in';

// ── Colour palette for email ──
const COLORS = {
  primary: '#0d9488',
  primaryLight: '#ccfbf1',
  accent: '#a3e635',
  dark: '#1e293b',
  muted: '#64748b',
  bg: '#f8fafc',
  white: '#ffffff',
  border: '#e2e8f0',
  warning: '#f59e0b',
  danger: '#ef4444',
  success: '#22c55e',
};

// ──────────────────────────────────────────────
// Report data generators
// ──────────────────────────────────────────────

async function queryByVendor(tableName, vendorId) {
  const params = {
    TableName: tableName,
    KeyConditionExpression: 'vendorId = :vid',
    ExpressionAttributeValues: { ':vid': vendorId },
  };
  const { Items } = await docClient.send(new QueryCommand(params));
  return Items || [];
}

async function fetchFinanceData(vendorId) {
  const [quotations, invoices, purchaseOrders, creditNotes, subscriptions] = await Promise.all([
    queryByVendor('workspace_quotations', vendorId),
    queryByVendor('workspace_invoices', vendorId),
    queryByVendor('workspace_purchase_orders', vendorId),
    queryByVendor('workspace_credit_notes', vendorId),
    queryByVendor('workspace_subscriptions', vendorId),
  ]);

  return {
    quotations: {
      total: quotations.length,
      draft: quotations.filter(q => q.status?.toLowerCase() === 'draft').length,
      sent: quotations.filter(q => q.status?.toLowerCase() === 'sent').length,
      accepted: quotations.filter(q => q.status?.toLowerCase() === 'accepted').length,
      totalValue: quotations.reduce((sum, q) => sum + (parseFloat(q.total || q.grandTotal || 0)), 0),
    },
    invoices: {
      total: invoices.length,
      paid: invoices.filter(i => i.status?.toLowerCase() === 'paid').length,
      pending: invoices.filter(i => ['pending', 'sent', 'overdue'].includes(i.status?.toLowerCase())).length,
      overdue: invoices.filter(i => i.status?.toLowerCase() === 'overdue').length,
      totalValue: invoices.reduce((sum, i) => sum + (parseFloat(i.total || i.grandTotal || 0)), 0),
    },
    purchaseOrders: {
      total: purchaseOrders.length,
      totalValue: purchaseOrders.reduce((sum, p) => sum + (parseFloat(p.total || p.grandTotal || 0)), 0),
    },
    creditNotes: {
      total: creditNotes.length,
      totalValue: creditNotes.reduce((sum, c) => sum + (parseFloat(c.total || c.grandTotal || 0)), 0),
    },
    subscriptions: {
      total: subscriptions.length,
      active: subscriptions.filter(s => s.status?.toLowerCase() === 'active').length,
    },
  };
}

async function fetchWorkspaceTasks(vendorId) {
  // Scan for workspaces owned/shared by this vendor
  const params = {
    TableName: 'workspaces_table',
    FilterExpression: 'vendorId = :vid',
    ExpressionAttributeValues: { ':vid': vendorId },
  };
  const { Items } = await docClient.send(new ScanCommand(params));
  const workspaces = Items || [];

  let totalTasks = 0;
  let pendingTasks = 0;
  let completedTasks = 0;
  let overdueTasks = 0;
  const now = new Date();

  for (const ws of workspaces) {
    const tasks = ws.tasks || ws.elements?.filter(e => e.type === 'task') || [];
    for (const task of tasks) {
      totalTasks++;
      const status = (task.status || '').toLowerCase();
      if (status === 'completed' || status === 'done') completedTasks++;
      else {
        pendingTasks++;
        if (task.dueDate && new Date(task.dueDate) < now) overdueTasks++;
      }
    }
  }

  return { workspaceCount: workspaces.length, totalTasks, pendingTasks, completedTasks, overdueTasks };
}

async function fetchLeadData(vendorId) {
  const params = {
    TableName: 'lead_invitations_table',
    IndexName: 'VendorIdIndex',
    KeyConditionExpression: 'vendorId = :vid',
    ExpressionAttributeValues: { ':vid': vendorId },
  };
  const { Items } = await docClient.send(new QueryCommand(params));
  const leads = Items || [];

  return {
    total: leads.length,
    pending: leads.filter(l => l.pmDecision?.toLowerCase() === 'pending' || !l.pmDecision).length,
    accepted: leads.filter(l => l.pmDecision?.toLowerCase() === 'accepted').length,
    rejected: leads.filter(l => l.pmDecision?.toLowerCase() === 'rejected').length,
  };
}

async function fetchProjectData(vendorId) {
  const params = {
    TableName: 'projects',
    FilterExpression: 'contains(vendorId, :vid) OR vendorId = :vid',
    ExpressionAttributeValues: { ':vid': vendorId },
  };
  const { Items } = await docClient.send(new ScanCommand(params));
  const projects = Items || [];

  return {
    total: projects.length,
    active: projects.filter(p => p.status?.toLowerCase() === 'active' || p.status?.toLowerCase() === 'in_progress').length,
    completed: projects.filter(p => p.status?.toLowerCase() === 'completed').length,
  };
}

// ── Aggregate scope data ──
async function getReportData(vendorId, scope) {
  switch (scope) {
    case 'finance_summary':
      return { type: 'finance', data: await fetchFinanceData(vendorId) };
    case 'invoice':
      return { type: 'invoice', data: (await fetchFinanceData(vendorId)).invoices };
    case 'quotation':
      return { type: 'quotation', data: (await fetchFinanceData(vendorId)).quotations };
    case 'purchase_order':
      return { type: 'purchase_order', data: (await fetchFinanceData(vendorId)).purchaseOrders };
    case 'credit_note':
      return { type: 'credit_note', data: (await fetchFinanceData(vendorId)).creditNotes };
    case 'subscription':
      return { type: 'subscription', data: (await fetchFinanceData(vendorId)).subscriptions };
    case 'workspace_task':
      return { type: 'workspace_task', data: await fetchWorkspaceTasks(vendorId) };
    case 'lead':
      return { type: 'lead', data: await fetchLeadData(vendorId) };
    case 'project':
      return { type: 'project', data: await fetchProjectData(vendorId) };
    case 'dashboard_summary': {
      const [finance, tasks, leads, projects] = await Promise.all([
        fetchFinanceData(vendorId),
        fetchWorkspaceTasks(vendorId),
        fetchLeadData(vendorId),
        fetchProjectData(vendorId),
      ]);
      return { type: 'dashboard', data: { finance, tasks, leads, projects } };
    }
    case 'payment':
      return { type: 'payment', data: (await fetchFinanceData(vendorId)).invoices }; // payments track via invoices
    default:
      return { type: 'generic', data: {} };
  }
}

// ──────────────────────────────────────────────
// Email template builder
// ──────────────────────────────────────────────

function buildStatCard(label, value, color = COLORS.primary) {
  return `
    <td style="padding: 8px;">
      <div style="background: ${COLORS.white}; border: 1px solid ${COLORS.border}; border-radius: 12px; padding: 16px; text-align: center; min-width: 120px;">
        <div style="font-size: 28px; font-weight: 700; color: ${color};">${value}</div>
        <div style="font-size: 12px; color: ${COLORS.muted}; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px;">${label}</div>
      </div>
    </td>`;
}

function buildReportEmailHTML(schedule, reportData) {
  const { title, scope, recurrence } = schedule;
  const { type, data } = reportData;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  let bodyContent = '';

  if (type === 'dashboard') {
    bodyContent = `
      <h2 style="color: ${COLORS.dark}; margin: 24px 0 12px; font-size: 18px;">📊 Finance Overview</h2>
      <table cellpadding="0" cellspacing="0" style="width: 100%;"><tr>
        ${buildStatCard('Invoices', data.finance.invoices.total, COLORS.primary)}
        ${buildStatCard('Paid', data.finance.invoices.paid, COLORS.success)}
        ${buildStatCard('Overdue', data.finance.invoices.overdue, COLORS.danger)}
        ${buildStatCard('Quotations', data.finance.quotations.total, COLORS.primary)}
      </tr></table>
      <table cellpadding="0" cellspacing="0" style="width: 100%; margin-top: 4px;"><tr>
        ${buildStatCard('Total Invoice Value', '₹' + data.finance.invoices.totalValue.toLocaleString('en-IN'), COLORS.dark)}
        ${buildStatCard('Total Quotation Value', '₹' + data.finance.quotations.totalValue.toLocaleString('en-IN'), COLORS.dark)}
      </tr></table>

      <h2 style="color: ${COLORS.dark}; margin: 24px 0 12px; font-size: 18px;">📋 Tasks</h2>
      <table cellpadding="0" cellspacing="0" style="width: 100%;"><tr>
        ${buildStatCard('Workspaces', data.tasks.workspaceCount)}
        ${buildStatCard('Total Tasks', data.tasks.totalTasks)}
        ${buildStatCard('Pending', data.tasks.pendingTasks, COLORS.warning)}
        ${buildStatCard('Overdue', data.tasks.overdueTasks, COLORS.danger)}
      </tr></table>

      <h2 style="color: ${COLORS.dark}; margin: 24px 0 12px; font-size: 18px;">🎯 Leads</h2>
      <table cellpadding="0" cellspacing="0" style="width: 100%;"><tr>
        ${buildStatCard('Total Leads', data.leads.total)}
        ${buildStatCard('Pending', data.leads.pending, COLORS.warning)}
        ${buildStatCard('Accepted', data.leads.accepted, COLORS.success)}
        ${buildStatCard('Rejected', data.leads.rejected, COLORS.danger)}
      </tr></table>

      <h2 style="color: ${COLORS.dark}; margin: 24px 0 12px; font-size: 18px;">🚀 Projects</h2>
      <table cellpadding="0" cellspacing="0" style="width: 100%;"><tr>
        ${buildStatCard('Total Projects', data.projects.total)}
        ${buildStatCard('Active', data.projects.active, COLORS.primary)}
        ${buildStatCard('Completed', data.projects.completed, COLORS.success)}
      </tr></table>`;
  } else if (type === 'finance') {
    bodyContent = `
      <h2 style="color: ${COLORS.dark}; margin: 24px 0 12px; font-size: 18px;">💰 Finance Summary</h2>
      <table cellpadding="0" cellspacing="0" style="width: 100%;"><tr>
        ${buildStatCard('Invoices', data.invoices.total)}
        ${buildStatCard('Paid', data.invoices.paid, COLORS.success)}
        ${buildStatCard('Overdue', data.invoices.overdue, COLORS.danger)}
      </tr></table>
      <table cellpadding="0" cellspacing="0" style="width: 100%; margin-top: 4px;"><tr>
        ${buildStatCard('Quotations', data.quotations.total)}
        ${buildStatCard('Accepted', data.quotations.accepted, COLORS.success)}
        ${buildStatCard('Draft', data.quotations.draft, COLORS.muted)}
      </tr></table>
      <table cellpadding="0" cellspacing="0" style="width: 100%; margin-top: 4px;"><tr>
        ${buildStatCard('Total Invoice Value', '₹' + data.invoices.totalValue.toLocaleString('en-IN'), COLORS.dark)}
        ${buildStatCard('POs', data.purchaseOrders.total)}
        ${buildStatCard('Credit Notes', data.creditNotes.total)}
      </tr></table>`;
  } else if (type === 'invoice') {
    bodyContent = `
      <h2 style="color: ${COLORS.dark}; margin: 24px 0 12px; font-size: 18px;">🧾 Invoice Report</h2>
      <table cellpadding="0" cellspacing="0" style="width: 100%;"><tr>
        ${buildStatCard('Total', data.total)}
        ${buildStatCard('Paid', data.paid, COLORS.success)}
        ${buildStatCard('Pending', data.pending, COLORS.warning)}
        ${buildStatCard('Overdue', data.overdue, COLORS.danger)}
      </tr></table>
      <table cellpadding="0" cellspacing="0" style="width: 100%; margin-top: 4px;"><tr>
        ${buildStatCard('Total Value', '₹' + data.totalValue.toLocaleString('en-IN'), COLORS.dark)}
      </tr></table>`;
  } else if (type === 'workspace_task') {
    bodyContent = `
      <h2 style="color: ${COLORS.dark}; margin: 24px 0 12px; font-size: 18px;">📋 Workspace Task Report</h2>
      <table cellpadding="0" cellspacing="0" style="width: 100%;"><tr>
        ${buildStatCard('Workspaces', data.workspaceCount)}
        ${buildStatCard('Total Tasks', data.totalTasks)}
        ${buildStatCard('Pending', data.pendingTasks, COLORS.warning)}
        ${buildStatCard('Overdue', data.overdueTasks, COLORS.danger)}
      </tr></table>
      <table cellpadding="0" cellspacing="0" style="width: 100%; margin-top: 4px;"><tr>
        ${buildStatCard('Completed', data.completedTasks, COLORS.success)}
      </tr></table>`;
  } else if (type === 'lead') {
    bodyContent = `
      <h2 style="color: ${COLORS.dark}; margin: 24px 0 12px; font-size: 18px;">🎯 Lead Report</h2>
      <table cellpadding="0" cellspacing="0" style="width: 100%;"><tr>
        ${buildStatCard('Total Leads', data.total)}
        ${buildStatCard('Pending', data.pending, COLORS.warning)}
        ${buildStatCard('Accepted', data.accepted, COLORS.success)}
        ${buildStatCard('Rejected', data.rejected, COLORS.danger)}
      </tr></table>`;
  } else if (type === 'project') {
    bodyContent = `
      <h2 style="color: ${COLORS.dark}; margin: 24px 0 12px; font-size: 18px;">🚀 Project Report</h2>
      <table cellpadding="0" cellspacing="0" style="width: 100%;"><tr>
        ${buildStatCard('Total', data.total)}
        ${buildStatCard('Active', data.active, COLORS.primary)}
        ${buildStatCard('Completed', data.completed, COLORS.success)}
      </tr></table>`;
  } else {
    // Generic card for quotation, purchase_order, credit_note, subscription, payment
    const scopeLabel = scope.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    bodyContent = `
      <h2 style="color: ${COLORS.dark}; margin: 24px 0 12px; font-size: 18px;">📄 ${scopeLabel} Report</h2>
      <table cellpadding="0" cellspacing="0" style="width: 100%;"><tr>
        ${buildStatCard('Total', data.total ?? 'N/A')}
        ${data.active !== undefined ? buildStatCard('Active', data.active, COLORS.success) : ''}
        ${data.totalValue !== undefined ? buildStatCard('Value', '₹' + (data.totalValue || 0).toLocaleString('en-IN'), COLORS.dark) : ''}
      </tr></table>`;
  }

  const frequencyLabel = recurrence === 'once' ? 'One-time' : recurrence.charAt(0).toUpperCase() + recurrence.slice(1);

  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin: 0; padding: 0; background: ${COLORS.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table cellpadding="0" cellspacing="0" style="width: 100%; max-width: 640px; margin: 0 auto;">
    <tr><td style="padding: 24px 20px;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, ${COLORS.primary} 0%, #14b8a6 60%, ${COLORS.accent} 100%); border-radius: 16px 16px 0 0; padding: 28px 24px; text-align: center;">
        <div style="font-size: 28px; margin-bottom: 8px;">⭐</div>
        <div style="font-size: 22px; font-weight: 700; color: ${COLORS.white}; letter-spacing: -0.3px;">${title}</div>
        <div style="font-size: 13px; color: rgba(255,255,255,0.85); margin-top: 6px;">${dateStr} · ${frequencyLabel} Report</div>
      </div>

      <!-- Body -->
      <div style="background: ${COLORS.white}; border: 1px solid ${COLORS.border}; border-top: none; border-radius: 0 0 16px 16px; padding: 20px 24px 28px;">
        ${bodyContent}

        <!-- Footer -->
        <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid ${COLORS.border}; text-align: center;">
          <a href="https://caasdiglobal.in" style="display: inline-block; background: ${COLORS.primary}; color: ${COLORS.white}; text-decoration: none; padding: 10px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">Open Dashboard</a>
          <div style="margin-top: 16px; font-size: 11px; color: ${COLORS.muted};">
            You received this because you set up a ${frequencyLabel.toLowerCase()} report on CaaS Digital Global.<br>
            Manage your scheduled reports from the AI Assistant panel.
          </div>
        </div>
      </div>
    </td></tr>
  </table>
</body></html>`;
}

function buildReminderEmailHTML(schedule) {
  const { title, description, scope, entityId, entityName, dueDate } = schedule;
  const scopeLabel = scope.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const dueDateStr = dueDate ? new Date(dueDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Soon';

  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin: 0; padding: 0; background: ${COLORS.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table cellpadding="0" cellspacing="0" style="width: 100%; max-width: 640px; margin: 0 auto;">
    <tr><td style="padding: 24px 20px;">
      <div style="background: linear-gradient(135deg, ${COLORS.warning} 0%, #fb923c 100%); border-radius: 16px 16px 0 0; padding: 28px 24px; text-align: center;">
        <div style="font-size: 28px; margin-bottom: 8px;">⏰</div>
        <div style="font-size: 22px; font-weight: 700; color: ${COLORS.white};">${title}</div>
        <div style="font-size: 13px; color: rgba(255,255,255,0.85); margin-top: 6px;">Deadline Reminder</div>
      </div>
      <div style="background: ${COLORS.white}; border: 1px solid ${COLORS.border}; border-top: none; border-radius: 0 0 16px 16px; padding: 24px;">
        <div style="background: ${COLORS.primaryLight}; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <div style="font-size: 14px; color: ${COLORS.muted}; margin-bottom: 8px;">📋 ${scopeLabel}</div>
          ${entityName ? `<div style="font-size: 16px; font-weight: 600; color: ${COLORS.dark};">${entityName}</div>` : ''}
          ${entityId ? `<div style="font-size: 13px; color: ${COLORS.muted}; margin-top: 4px;">ID: ${entityId}</div>` : ''}
          <div style="font-size: 15px; font-weight: 600; color: ${COLORS.danger}; margin-top: 12px;">📅 Due: ${dueDateStr}</div>
          ${description ? `<div style="font-size: 14px; color: ${COLORS.dark}; margin-top: 8px;">${description}</div>` : ''}
        </div>
        <div style="text-align: center; margin-top: 24px;">
          <a href="https://caasdiglobal.in" style="display: inline-block; background: ${COLORS.primary}; color: ${COLORS.white}; text-decoration: none; padding: 10px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">View in Dashboard</a>
        </div>
        <div style="margin-top: 20px; text-align: center; font-size: 11px; color: ${COLORS.muted};">
          This is an automated reminder from CaaS Digital Global.
        </div>
      </div>
    </td></tr>
  </table>
</body></html>`;
}

// ──────────────────────────────────────────────
// Send functions
// ──────────────────────────────────────────────

export async function sendReportEmail(schedule) {
  const { vendorId, vendorEmail, scope, title } = schedule;
  if (!vendorEmail) {
    console.warn(`[ReportEmail] No email for vendor ${vendorId}, skipping email send`);
    return false;
  }

  try {
    const reportData = await getReportData(vendorId, scope);
    const html = buildReportEmailHTML(schedule, reportData);

    await sesClient.send(new SendEmailCommand({
      Source: SES_FROM,
      Destination: { ToAddresses: [vendorEmail] },
      Message: {
        Subject: { Data: `📊 ${title} — CaaS Digital Global`, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    }));

    console.log(`[ReportEmail] Sent report "${title}" to ${vendorEmail} via SES`);
    return true;
  } catch (err) {
    console.error(`[ReportEmail] Failed to send report to ${vendorEmail}:`, err.message);
    return false;
  }
}

export async function sendReminderEmail(schedule) {
  const { vendorId, vendorEmail, title } = schedule;
  if (!vendorEmail) {
    console.warn(`[ReminderEmail] No email for vendor ${vendorId}, skipping`);
    return false;
  }

  try {
    const html = buildReminderEmailHTML(schedule);

    await sesClient.send(new SendEmailCommand({
      Source: SES_FROM,
      Destination: { ToAddresses: [vendorEmail] },
      Message: {
        Subject: { Data: `⏰ ${title} — CaaS Digital Global`, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    }));

    console.log(`[ReminderEmail] Sent reminder "${title}" to ${vendorEmail} via SES`);
    return true;
  } catch (err) {
    console.error(`[ReminderEmail] Failed to send reminder to ${vendorEmail}:`, err.message);
    return false;
  }
}

export default {
  sendReportEmail,
  sendReminderEmail,
  getReportData,
};
