// ============================================================
// FILE: modules/ai/tools/financeTool.js
// PURPOSE: LangChain tools for querying invoices, quotations,
//          purchase orders, credit notes, and subscriptions.
// ============================================================

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// Helper: query a table partitioned by vendorId
async function queryByVendor(tableName, vendorId, projExpr, exprNames) {
  const params = {
    TableName: tableName,
    KeyConditionExpression: 'vendorId = :vid',
    ExpressionAttributeValues: { ':vid': vendorId },
  };
  if (projExpr) {
    params.ProjectionExpression = projExpr;
    if (exprNames) params.ExpressionAttributeNames = exprNames;
  }
  const result = await docClient.send(new QueryCommand(params));
  console.log(`[AI][FinanceTool] queryByVendor("${tableName}") returned ${result.Items?.length || 0} items`);
  return result.Items || [];
}

export function createFinanceTools(vendorId) {
  const getQuotations = new DynamicStructuredTool({
    name: 'getQuotations',
    description:
      'Get quotations created by this vendor. Returns quotation numbers, customer names, totals, statuses, and dates.',
    schema: z.object({
      status: z.string().optional().describe('Optional: "draft", "sent", "accepted", "rejected", "all"'),
    }),
    func: async ({ status }) => {
      try {
        let items = await queryByVendor('workspace_quotations', vendorId);
        if (status && status !== 'all') {
          items = items.filter((i) => i.status?.toLowerCase() === status.toLowerCase());
        }
        const summary = items.map((q) => ({
          quotationId: q.quotationId,
          quotationNumber: q.quotationNumber || q.quotationId,
          customerName: q.customerName || 'Unknown',
          total: q.total || q.grandTotal || 0,
          status: q.status || 'draft',
          createdAt: q.createdAt,
        }));
        return JSON.stringify({ count: summary.length, quotations: summary });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  const getInvoices = new DynamicStructuredTool({
    name: 'getInvoices',
    description:
      'Get invoices created by this vendor. Returns invoice numbers, customer names, amounts, due dates, and statuses.',
    schema: z.object({
      status: z.string().optional().describe('Optional: "draft", "sent", "paid", "overdue", "all"'),
    }),
    func: async ({ status }) => {
      try {
        let items = await queryByVendor('workspace_invoices', vendorId);
        if (status && status !== 'all') {
          items = items.filter((i) => i.status?.toLowerCase() === status.toLowerCase());
        }
        const summary = items.map((inv) => ({
          invoiceId: inv.invoiceId,
          invoiceNumber: inv.invoiceNumber || inv.invoiceId,
          customerName: inv.customerName || 'Unknown',
          total: inv.total || inv.grandTotal || 0,
          dueDate: inv.dueDate || null,
          status: inv.status || 'draft',
          createdAt: inv.createdAt,
        }));
        return JSON.stringify({ count: summary.length, invoices: summary });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  const getPurchaseOrders = new DynamicStructuredTool({
    name: 'getPurchaseOrders',
    description: 'Get purchase orders for this vendor. Returns PO numbers, statuses, and amounts.',
    schema: z.object({
      status: z.string().optional().describe('Optional status filter'),
    }),
    func: async ({ status }) => {
      try {
        let items = await queryByVendor('workspace_purchase_orders', vendorId);
        if (status && status !== 'all') {
          items = items.filter((i) => i.status?.toLowerCase() === status.toLowerCase());
        }
        const summary = items.map((po) => ({
          purchaseOrderId: po.purchaseOrderId,
          poNumber: po.poNumber || po.purchaseOrderId,
          referenceQuoteNumber: po.referenceQuoteNumber,
          total: po.total || po.grandTotal || 0,
          status: po.status || 'draft',
          createdAt: po.createdAt,
        }));
        return JSON.stringify({ count: summary.length, purchaseOrders: summary });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  const getCreditNotes = new DynamicStructuredTool({
    name: 'getCreditNotes',
    description: 'Get credit notes for this vendor.',
    schema: z.object({
      status: z.string().optional().describe('Optional status filter'),
    }),
    func: async ({ status }) => {
      try {
        let items = await queryByVendor('workspace_credit_notes', vendorId);
        if (status && status !== 'all') {
          items = items.filter((i) => i.status?.toLowerCase() === status.toLowerCase());
        }
        const summary = items.map((cn) => ({
          creditNoteId: cn.creditNoteId,
          customerName: cn.customerName || 'Unknown',
          total: cn.total || cn.grandTotal || 0,
          status: cn.status || 'draft',
          createdAt: cn.createdAt,
        }));
        return JSON.stringify({ count: summary.length, creditNotes: summary });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  const getSubscriptions = new DynamicStructuredTool({
    name: 'getSubscriptions',
    description: 'Get recurring subscriptions for this vendor — billing cycles, amounts, next billing dates.',
    schema: z.object({
      status: z.string().optional().describe('Optional: "active", "paused", "cancelled", "all"'),
    }),
    func: async ({ status }) => {
      try {
        let items = await queryByVendor('workspace_subscriptions', vendorId);
        if (status && status !== 'all') {
          items = items.filter((i) => i.status?.toLowerCase() === status.toLowerCase());
        }
        const summary = items.map((sub) => ({
          subscriptionId: sub.subscriptionId,
          customerName: sub.customerName || 'Unknown',
          billingCycle: sub.billingCycle,
          amount: sub.amount || 0,
          status: sub.status || 'active',
          nextBillingDate: sub.nextBillingDate,
          createdAt: sub.createdAt,
        }));
        return JSON.stringify({ count: summary.length, subscriptions: summary });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  const getFinanceSummary = new DynamicStructuredTool({
    name: 'getFinanceSummary',
    description:
      'Get a high-level finance summary for this vendor — total quotations, invoices, POs, credit notes with counts and totals.',
    schema: z.object({}),
    func: async () => {
      try {
        const [quotations, invoices, pos, creditNotes] = await Promise.all([
          queryByVendor('workspace_quotations', vendorId, 'vendorId, #s, #t', { '#s': 'status', '#t': 'total' }),
          queryByVendor('workspace_invoices', vendorId, 'vendorId, #s, #t', { '#s': 'status', '#t': 'total' }),
          queryByVendor('workspace_purchase_orders', vendorId, 'vendorId, #s, #t', { '#s': 'status', '#t': 'total' }),
          queryByVendor('workspace_credit_notes', vendorId, 'vendorId, #s, #t', { '#s': 'status', '#t': 'total' }),
        ]);

        const sum = (arr) => arr.reduce((a, i) => a + (Number(i.total) || 0), 0);

        return JSON.stringify({
          quotations: { count: quotations.length, totalValue: sum(quotations) },
          invoices: { count: invoices.length, totalValue: sum(invoices) },
          purchaseOrders: { count: pos.length, totalValue: sum(pos) },
          creditNotes: { count: creditNotes.length, totalValue: sum(creditNotes) },
        });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  return [getQuotations, getInvoices, getPurchaseOrders, getCreditNotes, getSubscriptions, getFinanceSummary];
}
