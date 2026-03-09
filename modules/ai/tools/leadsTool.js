// ============================================================
// FILE: modules/ai/tools/leadsTool.js
// PURPOSE: LangChain tools for querying vendor leads.
//
// The primary leads source is `lead_invitations_table` with a
// `VendorIdIndex` GSI (vendorId PK).  This is the same table
// the existing vendorLeadController.js queries.  We also check
// the legacy `leads` and `project_leads` tables as fallback.
// ============================================================

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);

const LEAD_INVITATIONS_TABLE = 'lead_invitations_table';
const LEADS_TABLE = 'leads';
const PROJECT_LEADS_TABLE = 'project_leads';

export function createLeadsTools(vendorId) {
  const getLeads = new DynamicStructuredTool({
    name: 'getLeads',
    description:
      'Get leads assigned to this vendor. Can filter by status. Returns lead titles, project names, statuses, budgets, and PM decision info.',
    schema: z.object({
      status: z
        .string()
        .optional()
        .describe('Optional: "pending", "accepted", "rejected", "all" (default: "all")'),
    }),
    func: async ({ status }) => {
      try {
        console.log(`[AI][LeadsTool] getLeads called for vendorId="${vendorId}", status="${status || 'all'}"`);

        // Primary: Query lead_invitations_table via VendorIdIndex GSI
        const invResult = await docClient.send(
          new QueryCommand({
            TableName: LEAD_INVITATIONS_TABLE,
            IndexName: 'VendorIdIndex',
            KeyConditionExpression: 'vendorId = :vid',
            ExpressionAttributeValues: { ':vid': vendorId },
            ScanIndexForward: false,
          })
        );
        let leads = invResult.Items || [];
        console.log(`[AI][LeadsTool] lead_invitations_table returned ${leads.length} leads`);

        // Fallback: also check legacy leads table
        try {
          const legacyResult = await docClient.send(
            new ScanCommand({
              TableName: LEADS_TABLE,
              FilterExpression: 'assignedVendorId = :vid',
              ExpressionAttributeValues: { ':vid': vendorId },
            })
          );
          const legacyLeads = legacyResult.Items || [];
          console.log(`[AI][LeadsTool] legacy leads table returned ${legacyLeads.length} leads`);
          if (legacyLeads.length > 0) {
            // Merge, dedup by leadId
            const seenIds = new Set(leads.map((l) => l.leadId));
            for (const ll of legacyLeads) {
              if (ll.leadId && !seenIds.has(ll.leadId)) {
                leads.push(ll);
              }
            }
          }
        } catch (legacyErr) {
          console.warn(`[AI][LeadsTool] Legacy leads table query failed: ${legacyErr.message}`);
        }

        if (status && status !== 'all') {
          leads = leads.filter((l) => l.status?.toLowerCase() === status.toLowerCase());
        }

        const summary = leads.map((l) => ({
          leadId: l.leadId,
          title: l.leadTitle || l.name || 'Unnamed lead',
          projectName: l.projectDetails?.name || l.projectName || null,
          projectId: l.projectId || null,
          status: l.status || 'pending',
          priority: l.priority || null,
          estimatedBudget: l.estimatedBudget || l.budget || null,
          estimatedTimeline: l.estimatedTimeline || l.duration || null,
          specialization: l.specialization || null,
          pmId: l.pmId || l.sentByPmId || null,
          sentAt: l.sentAt || l.createdAt || null,
          pmDecision: l.pmDecision ? {
            approved: l.pmDecision.approved,
            workspaceAccess: l.pmDecision.workspaceAccess,
          } : null,
          vendorResponse: l.vendorResponse ? {
            status: l.vendorResponse.status,
            message: l.vendorResponse.message,
          } : null,
        }));

        console.log(`[AI][LeadsTool] Returning ${summary.length} leads`);
        return JSON.stringify({ count: summary.length, leads: summary });
      } catch (err) {
        console.error(`[AI][LeadsTool] Error:`, err);
        return JSON.stringify({ error: err.message });
      }
    },
  });

  const getLeadStats = new DynamicStructuredTool({
    name: 'getLeadStats',
    description: 'Get a statistical summary of leads for this vendor — counts by status.',
    schema: z.object({}),
    func: async () => {
      try {
        console.log(`[AI][LeadsTool] getLeadStats called for vendorId="${vendorId}"`);

        const invResult = await docClient.send(
          new QueryCommand({
            TableName: LEAD_INVITATIONS_TABLE,
            IndexName: 'VendorIdIndex',
            KeyConditionExpression: 'vendorId = :vid',
            ExpressionAttributeValues: { ':vid': vendorId },
          })
        );
        const leads = invResult.Items || [];
        const stats = { total: leads.length };
        for (const l of leads) {
          const s = (l.status || 'unknown').toLowerCase();
          stats[s] = (stats[s] || 0) + 1;
        }

        console.log(`[AI][LeadsTool] Stats:`, stats);
        return JSON.stringify(stats);
      } catch (err) {
        console.error(`[AI][LeadsTool] getLeadStats error:`, err);
        return JSON.stringify({ error: err.message });
      }
    },
  });

  const getProjectLeads = new DynamicStructuredTool({
    name: 'getProjectLeads',
    description: 'Get project-specific leads assigned to this vendor from the project_leads table.',
    schema: z.object({
      status: z.string().optional().describe('Optional status filter'),
    }),
    func: async ({ status }) => {
      try {
        console.log(`[AI][LeadsTool] getProjectLeads called for vendorId="${vendorId}"`);

        const result = await docClient.send(
          new ScanCommand({
            TableName: PROJECT_LEADS_TABLE,
            FilterExpression: 'assignedVendorId = :vid',
            ExpressionAttributeValues: { ':vid': vendorId },
          })
        );
        let leads = result.Items || [];
        console.log(`[AI][LeadsTool] project_leads returned ${leads.length} items`);

        if (status && status !== 'all') {
          leads = leads.filter((l) => l.status?.toLowerCase() === status.toLowerCase());
        }
        const summary = leads.map((l) => ({
          leadId: l.leadId,
          name: l.name || 'Unnamed',
          status: l.status,
          clientId: l.clientId,
          createdAt: l.createdAt,
        }));
        return JSON.stringify({ count: summary.length, projectLeads: summary });
      } catch (err) {
        console.error(`[AI][LeadsTool] getProjectLeads error:`, err);
        return JSON.stringify({ error: err.message });
      }
    },
  });

  return [getLeads, getLeadStats, getProjectLeads];
}
