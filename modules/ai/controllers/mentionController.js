// ============================================================
// FILE: modules/ai/controllers/mentionController.js
// PURPOSE: API endpoint for @ mention entity search.
//          Searches workspaces, projects, invoices, quotations,
//          leads, etc. by name/ID for context scoping in AI chat.
// ============================================================

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// Table names
const TABLES = {
  workspace: 'workspaces_table',
  project_legacy: 'projects',
  project_pm: 'pm_projects',
  invoice: process.env.INVOICE_TABLE || 'workspace_invoices',
  quotation: process.env.QUOTATION_TABLE || 'workspace_quotations',
  lead: process.env.LEAD_TABLE || 'lead_invitations_table',
  purchase_order: process.env.PO_TABLE || 'workspace_purchase_orders',
  credit_note: process.env.CREDIT_NOTE_TABLE || 'workspace_credit_notes',
  subscription: process.env.SUBSCRIPTION_TABLE || 'workspace_subscriptions',
};

// Entity type config: which fields to search and return
// queryMode: 'scan' = ScanCommand with FilterExpression, 'query' = QueryCommand with vendorId partition key
const ENTITY_CONFIG = {
  workspace: {
    table: TABLES.workspace,
    vendorField: 'vendorId',
    queryMode: 'scan', // vendorId is NOT the partition key
    searchFields: ['title', 'workspaceId'],
    displayField: 'title',
    idField: 'workspaceId',
    icon: '📋',
  },
  project: {
    // Searches both legacy 'projects' and 'pm_projects' tables
    tables: [TABLES.project_legacy, TABLES.project_pm],
    vendorField: 'vendorId',
    queryMode: 'scan',
    searchFields: ['name', 'projectName', 'projectId'],
    displayField: 'name',
    displayFallback: 'projectName',
    idField: 'projectId',
    idFallback: 'id',
    icon: '🚀',
  },
  invoice: {
    table: TABLES.invoice,
    vendorField: 'vendorId',
    queryMode: 'query', // vendorId is partition key
    searchFields: ['invoiceNumber', 'invoiceId', 'customerName'],
    displayField: 'invoiceNumber',
    idField: 'invoiceId',
    icon: '🧾',
  },
  quotation: {
    table: TABLES.quotation,
    vendorField: 'vendorId',
    queryMode: 'query',
    searchFields: ['quotationNumber', 'quotationId', 'customerName'],
    displayField: 'quotationNumber',
    idField: 'quotationId',
    icon: '📝',
  },
  lead: {
    table: TABLES.lead,
    vendorField: 'vendorId',
    queryMode: 'scan',
    searchFields: ['clientName', 'leadId', 'projectName'],
    displayField: 'clientName',
    idField: 'leadId',
    icon: '🎯',
  },
  purchase_order: {
    table: TABLES.purchase_order,
    vendorField: 'vendorId',
    queryMode: 'query',
    searchFields: ['poNumber', 'purchaseOrderId'],
    displayField: 'poNumber',
    idField: 'purchaseOrderId',
    icon: '📦',
  },
  credit_note: {
    table: TABLES.credit_note,
    vendorField: 'vendorId',
    queryMode: 'query',
    searchFields: ['creditNoteNumber', 'creditNoteId'],
    displayField: 'creditNoteNumber',
    idField: 'creditNoteId',
    icon: '📄',
  },
  subscription: {
    table: TABLES.subscription,
    vendorField: 'vendorId',
    queryMode: 'query',
    searchFields: ['subscriptionId', 'planName'],
    displayField: 'planName',
    idField: 'subscriptionId',
    icon: '🔁',
  },
};

/**
 * GET /api/ai/mentions/search?q=ProjectX&type=project
 * Search entities for @ mention autocomplete.
 * Query params:
 *   - q: search string (min 1 char)
 *   - type: optional entity type filter (workspace, project, invoice, etc.)
 */
export async function handleMentionSearch(req, res) {
  try {
    const vendorId = req.vendorId;
    if (!vendorId) {
      return res.status(401).json({ success: false, message: 'Vendor ID not resolved' });
    }

    const query = (req.query.q || '').trim().toLowerCase();
    const typeFilter = (req.query.type || '').trim().toLowerCase();

    if (!query) {
      return res.json({ success: true, data: [] });
    }

    // Determine which entity types to search
    const typesToSearch = typeFilter && ENTITY_CONFIG[typeFilter]
      ? [typeFilter]
      : Object.keys(ENTITY_CONFIG);

    const results = [];
    const searchPromises = typesToSearch.map(async (entityType) => {
      const config = ENTITY_CONFIG[entityType];
      if (!config) return;

      try {
        // Determine which tables to scan/query
        const tablesToSearch = config.tables || [config.table];

        for (const tableName of tablesToSearch) {
          let items = [];

          if (config.queryMode === 'query') {
            // Use efficient QueryCommand when vendorId is the partition key
            const queryResult = await docClient.send(
              new QueryCommand({
                TableName: tableName,
                KeyConditionExpression: `${config.vendorField} = :vid`,
                ExpressionAttributeValues: { ':vid': vendorId },
              })
            );
            items = queryResult.Items || [];
          } else {
            // Use ScanCommand for tables where vendorId is not the partition key
            // No Limit — scan all items and filter client-side for vendor match
            let scanItems = [];
            let lastKey = undefined;
            do {
              const scanResult = await docClient.send(
                new ScanCommand({
                  TableName: tableName,
                  FilterExpression: `${config.vendorField} = :vid`,
                  ExpressionAttributeValues: { ':vid': vendorId },
                  ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
                })
              );
              scanItems.push(...(scanResult.Items || []));
              lastKey = scanResult.LastEvaluatedKey;
            } while (lastKey);
            items = scanItems;
          }

          // Also check sharedWith for workspaces
          if (entityType === 'workspace') {
            let sharedItems = [];
            let lastKey2 = undefined;
            do {
              const sharedResult = await docClient.send(
                new ScanCommand({
                  TableName: tableName,
                  FilterExpression: 'contains(sharedWith, :vid)',
                  ExpressionAttributeValues: { ':vid': vendorId },
                  ...(lastKey2 ? { ExclusiveStartKey: lastKey2 } : {}),
                })
              );
              sharedItems.push(...(sharedResult.Items || []));
              lastKey2 = sharedResult.LastEvaluatedKey;
            } while (lastKey2);

            // Merge and deduplicate
            const existingIds = new Set(items.map((i) => i[config.idField]));
            for (const si of sharedItems) {
              if (!existingIds.has(si[config.idField])) {
                items.push(si);
              }
            }
          }

          for (const item of items) {
            // Check if any search field matches the query
            const matches = config.searchFields.some((field) => {
              const val = item[field];
              return val && String(val).toLowerCase().includes(query);
            });

            if (matches) {
              const displayName = item[config.displayField]
                || (config.displayFallback ? item[config.displayFallback] : null)
                || item[config.idField]
                || (config.idFallback ? item[config.idFallback] : null)
                || 'Unknown';

              const entityId = item[config.idField]
                || (config.idFallback ? item[config.idFallback] : null)
                || '';

              results.push({
                type: entityType,
                id: entityId,
                name: displayName,
                icon: config.icon,
                status: item.status || item.Status || undefined,
                extra: buildExtraInfo(entityType, item),
              });
            }
          }
        }
      } catch (err) {
        console.warn(`[AI][Mentions] Failed to search ${entityType}: ${err.message}`);
      }
    });

    await Promise.all(searchPromises);

    // Sort by relevance: exact prefix matches first, then contains
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase().startsWith(query) ? 0 : 1;
      const bExact = b.name.toLowerCase().startsWith(query) ? 0 : 1;
      return aExact - bExact;
    });

    return res.json({
      success: true,
      data: results.slice(0, 15), // Max 15 results
    });
  } catch (err) {
    console.error('[AI][Mentions] Search error:', err);
    return res.status(500).json({ success: false, message: 'Search failed' });
  }
}

/**
 * Build extra context info for display in mention dropdown.
 */
function buildExtraInfo(type, item) {
  switch (type) {
    case 'workspace':
      return item.taskCount ? `${item.taskCount} tasks` : undefined;
    case 'project':
      return item.status ? `Status: ${item.status}` : undefined;
    case 'invoice':
      return item.totalAmount ? `₹${item.totalAmount}` : undefined;
    case 'quotation':
      return item.totalAmount ? `₹${item.totalAmount}` : undefined;
    case 'lead':
      return item.status ? `Status: ${item.status}` : undefined;
    default:
      return undefined;
  }
}

/**
 * GET /api/ai/mentions/types
 * Return available entity types for mention autocomplete.
 */
export async function handleMentionTypes(req, res) {
  const types = Object.entries(ENTITY_CONFIG).map(([key, config]) => ({
    type: key,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    icon: config.icon,
  }));

  return res.json({ success: true, data: types });
}
