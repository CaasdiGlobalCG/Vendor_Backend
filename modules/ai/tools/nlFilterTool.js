// ============================================================
// FILE: modules/ai/tools/nlFilterTool.js
// PURPOSE: LangChain tool for Natural Language DynamoDB filtering.
//          Translates plain English queries like "invoices above
//          ₹50,000 that are overdue" into DynamoDB filter logic.
// ============================================================

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// ── Table aliases and field mappings ──
const TABLE_MAP = {
  invoices: 'workspace_invoices',
  quotations: 'workspace_quotations',
  purchase_orders: 'workspace_purchase_orders',
  credit_notes: 'workspace_credit_notes',
  subscriptions: 'workspace_subscriptions',
};

// Human-friendly field aliases → actual DynamoDB attribute names
const FIELD_ALIASES = {
  amount: 'total',
  value: 'total',
  price: 'total',
  total: 'total',
  grand_total: 'grandTotal',
  customer: 'customerName',
  client: 'customerName',
  customer_name: 'customerName',
  status: 'status',
  state: 'status',
  due_date: 'dueDate',
  due: 'dueDate',
  created: 'createdAt',
  created_at: 'createdAt',
  date: 'createdAt',
  number: 'invoiceNumber',
  invoice_number: 'invoiceNumber',
  quotation_number: 'quotationNumber',
  po_number: 'poNumber',
  billing_cycle: 'billingCycle',
  next_billing: 'nextBillingDate',
};

// Identify fields for each entity type
const ID_FIELDS = {
  invoices: { id: 'invoiceId', number: 'invoiceNumber' },
  quotations: { id: 'quotationId', number: 'quotationNumber' },
  purchase_orders: { id: 'purchaseOrderId', number: 'poNumber' },
  credit_notes: { id: 'creditNoteId', number: 'creditNoteId' },
  subscriptions: { id: 'subscriptionId', number: 'subscriptionId' },
};

// Summary field sets per entity
const SUMMARY_FIELDS = {
  invoices: (item) => ({
    invoiceId: item.invoiceId,
    invoiceNumber: item.invoiceNumber || item.invoiceId,
    customerName: item.customerName || 'Unknown',
    total: item.total || item.grandTotal || 0,
    dueDate: item.dueDate || null,
    status: item.status || 'draft',
    createdAt: item.createdAt,
  }),
  quotations: (item) => ({
    quotationId: item.quotationId,
    quotationNumber: item.quotationNumber || item.quotationId,
    customerName: item.customerName || 'Unknown',
    total: item.total || item.grandTotal || 0,
    status: item.status || 'draft',
    createdAt: item.createdAt,
  }),
  purchase_orders: (item) => ({
    purchaseOrderId: item.purchaseOrderId,
    poNumber: item.poNumber || item.purchaseOrderId,
    total: item.total || item.grandTotal || 0,
    status: item.status || 'draft',
    createdAt: item.createdAt,
  }),
  credit_notes: (item) => ({
    creditNoteId: item.creditNoteId,
    customerName: item.customerName || 'Unknown',
    total: item.total || item.grandTotal || 0,
    status: item.status || 'draft',
    createdAt: item.createdAt,
  }),
  subscriptions: (item) => ({
    subscriptionId: item.subscriptionId,
    customerName: item.customerName || 'Unknown',
    amount: item.amount || 0,
    billingCycle: item.billingCycle,
    status: item.status || 'active',
    nextBillingDate: item.nextBillingDate,
  }),
};

/**
 * Apply a single filter condition to an array of items in JS.
 * DynamoDB doesn't support complex ad-hoc filters well (no >, < on non-key attrs in filter expressions
 * for Query), so we fetch all vendor items and filter in memory.
 */
function applyFilter(items, field, operator, value) {
  const resolvedField = FIELD_ALIASES[field] || field;

  return items.filter((item) => {
    let itemVal = item[resolvedField];
    if (itemVal === undefined || itemVal === null) return false;

    // Numeric comparison
    if (['gt', 'gte', 'lt', 'lte'].includes(operator)) {
      const numVal = parseFloat(itemVal);
      const numTarget = parseFloat(value);
      if (isNaN(numVal) || isNaN(numTarget)) return false;
      switch (operator) {
        case 'gt': return numVal > numTarget;
        case 'gte': return numVal >= numTarget;
        case 'lt': return numVal < numTarget;
        case 'lte': return numVal <= numTarget;
      }
    }

    // Equality (case-insensitive for strings)
    if (operator === 'eq') {
      if (typeof itemVal === 'string' && typeof value === 'string') {
        return itemVal.toLowerCase() === value.toLowerCase();
      }
      return String(itemVal) === String(value);
    }

    // Not-equal
    if (operator === 'ne') {
      if (typeof itemVal === 'string' && typeof value === 'string') {
        return itemVal.toLowerCase() !== value.toLowerCase();
      }
      return String(itemVal) !== String(value);
    }

    // Contains (string)
    if (operator === 'contains') {
      return String(itemVal).toLowerCase().includes(String(value).toLowerCase());
    }

    // Date-based: before / after
    if (operator === 'before' || operator === 'after') {
      const dateVal = new Date(itemVal);
      const dateTarget = new Date(value);
      if (isNaN(dateVal) || isNaN(dateTarget)) return false;
      return operator === 'before' ? dateVal < dateTarget : dateVal > dateTarget;
    }

    // Overdue special case: dueDate is before today AND status is not "paid"
    if (operator === 'overdue') {
      const dueDate = new Date(item.dueDate);
      return !isNaN(dueDate) && dueDate < new Date() && (item.status || '').toLowerCase() !== 'paid';
    }

    return true;
  });
}


export function createNLFilterTools(vendorId) {
  /**
   * naturalLanguageFilter
   * The AI agent calls this tool by breaking down the user's natural language
   * query into structured filter parameters.
   */
  const naturalLanguageFilter = new DynamicStructuredTool({
    name: 'naturalLanguageFilter',
    description: `Advanced filter tool for querying invoices, quotations, purchase orders, credit notes, or subscriptions using structured conditions extracted from natural language.
Use this when the user asks for filtered/complex queries like:
- "Show invoices above ₹50,000 that are overdue"
- "Quotations sent to Acme Corp worth more than ₹1,00,000"
- "All purchase orders created this month"
- "Credit notes with status draft"
- "Unpaid invoices from last 30 days"

Break the user's request into entity + filters before calling this tool.`,
    schema: z.object({
      entity: z.enum(['invoices', 'quotations', 'purchase_orders', 'credit_notes', 'subscriptions'])
        .describe('The type of entity to filter'),
      filters: z.array(z.object({
        field: z.string().describe('The field to filter on: amount/total, status, customer, due_date, created, number, billing_cycle, next_billing'),
        operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'ne', 'contains', 'before', 'after', 'overdue'])
          .describe('Comparison operator: gt (>), gte (>=), lt (<), lte (<=), eq (==), ne (!=), contains (substring), before/after (dates), overdue (due date passed + not paid)'),
        value: z.string().describe('The value to compare against. For amounts use plain numbers (50000). For dates use ISO format (2025-01-01). For status use the status string (overdue, paid, draft, sent, etc).'),
      })).describe('Array of filter conditions to apply (logical AND)'),
      sortBy: z.string().optional().describe('Optional sort field: amount, date, due_date, status, customer'),
      sortOrder: z.enum(['asc', 'desc']).optional().describe('Sort direction (default: desc)'),
      limit: z.number().optional().describe('Max results to return (default: 20)'),
    }),
    func: async ({ entity, filters, sortBy, sortOrder, limit }) => {
      try {
        const tableName = TABLE_MAP[entity];
        if (!tableName) {
          return JSON.stringify({ error: `Unknown entity type: ${entity}` });
        }

        console.log(`[AI][NLFilter] Querying ${entity} for vendor="${vendorId}" with ${filters.length} filter(s)`);

        // Fetch all items for this vendor
        const result = await docClient.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'vendorId = :vid',
          ExpressionAttributeValues: { ':vid': vendorId },
        }));
        let items = result.Items || [];

        console.log(`[AI][NLFilter] Fetched ${items.length} raw ${entity}`);

        // Apply each filter condition (AND logic)
        for (const filter of filters) {
          items = applyFilter(items, filter.field, filter.operator, filter.value);
        }

        console.log(`[AI][NLFilter] After filtering: ${items.length} ${entity} match`);

        // Sort if requested
        if (sortBy) {
          const sortField = FIELD_ALIASES[sortBy] || sortBy;
          items.sort((a, b) => {
            const aVal = a[sortField];
            const bVal = b[sortField];
            // Numeric sort
            if (!isNaN(parseFloat(aVal)) && !isNaN(parseFloat(bVal))) {
              return sortOrder === 'asc'
                ? parseFloat(aVal) - parseFloat(bVal)
                : parseFloat(bVal) - parseFloat(aVal);
            }
            // String/date sort
            const aStr = String(aVal || '');
            const bStr = String(bVal || '');
            return sortOrder === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
          });
        }

        // Limit results
        const maxResults = limit || 20;
        const limited = items.slice(0, maxResults);

        // Map to summary format
        const summarize = SUMMARY_FIELDS[entity] || ((item) => item);
        const summaries = limited.map(summarize);

        // Compute aggregate stats
        const totalField = entity === 'subscriptions' ? 'amount' : 'total';
        const totalSum = items.reduce((sum, item) => sum + (parseFloat(item[totalField]) || parseFloat(item.grandTotal) || 0), 0);

        return JSON.stringify({
          entity,
          totalMatching: items.length,
          showing: summaries.length,
          totalValue: totalSum,
          filtersApplied: filters.map((f) => `${f.field} ${f.operator} ${f.value}`),
          results: summaries,
        });
      } catch (err) {
        console.error(`[AI][NLFilter] Error:`, err);
        return JSON.stringify({ error: err.message });
      }
    },
  });

  return [naturalLanguageFilter];
}
