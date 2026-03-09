// ============================================================
// FILE: modules/ai/tools/projectTool.js
// PURPOSE: LangChain tools for querying vendor projects.
// ============================================================

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);

export function createProjectTools(vendorId) {
  const getProjects = new DynamicStructuredTool({
    name: 'getProjects',
    description: 'Get projects associated with this vendor. Returns project names, IDs, statuses, and client info.',
    schema: z.object({
      status: z.string().optional().describe('Optional: "active", "completed", "on-hold", "all"'),
    }),
    func: async ({ status }) => {
      try {
        console.log(`[AI][ProjectTool] getProjects called for vendorId="${vendorId}", status="${status || 'all'}"`);
        // Query both projects tables
        const [legacyResult, pmResult] = await Promise.all([
          docClient.send(
            new ScanCommand({
              TableName: 'projects',
              FilterExpression: 'vendorId = :vid',
              ExpressionAttributeValues: { ':vid': vendorId },
            })
          ),
          docClient.send(
            new ScanCommand({
              TableName: 'pm_projects',
              FilterExpression: 'vendorId = :vid',
              ExpressionAttributeValues: { ':vid': vendorId },
            })
          ),
        ]);

        let projects = [
          ...(legacyResult.Items || []).map((p) => ({
            projectId: p.projectId,
            name: p.name || p.projectName || 'Unnamed',
            status: p.status || 'active',
            clientId: p.clientId,
            source: 'legacy',
            createdAt: p.createdAt,
          })),
          ...(pmResult.Items || []).map((p) => ({
            projectId: p.id || p.projectId,
            name: p.name || p.projectName || 'Unnamed',
            status: p.status || 'active',
            clientId: p.clientId,
            leadId: p.leadId,
            taskCount: (p.tasks || []).length,
            source: 'pm',
            createdAt: p.createdAt,
          })),
        ];

        console.log(`[AI][ProjectTool] legacy projects: ${legacyResult.Items?.length || 0}, pm_projects: ${pmResult.Items?.length || 0}`);

        if (status && status !== 'all') {
          projects = projects.filter((p) => p.status?.toLowerCase() === status.toLowerCase());
        }

        console.log(`[AI][ProjectTool] Returning ${projects.length} projects`);
        return JSON.stringify({ count: projects.length, projects });
      } catch (err) {
        console.error(`[AI][ProjectTool] Error:`, err);
        return JSON.stringify({ error: err.message });
      }
    },
  });

  return [getProjects];
}
