// ============================================================
// FILE: modules/ai/tools/workspaceTool.js
// PURPOSE: LangChain tools for querying workspace & task data.
// ============================================================

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const WORKSPACES_TABLE = 'workspaces_table';

// ── Helper: update workspace in DynamoDB ──
async function updateWorkspaceTasks(workspaceId, tasks) {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: WORKSPACES_TABLE,
        Key: { workspaceId },
        UpdateExpression: 'SET tasks = :tasks, updatedAt = :now',
        ExpressionAttributeValues: {
          ':tasks': tasks,
          ':now': new Date().toISOString(),
        },
      })
    );
  } catch (err) {
    console.error(`[AI][WorkspaceTool] UpdateCommand failed, trying PutCommand fallback:`, err.message);
    // Fallback: get full item and put it back with updated tasks
    const getResult = await docClient.send(new GetCommand({ TableName: WORKSPACES_TABLE, Key: { workspaceId } }));
    if (getResult.Item) {
      getResult.Item.tasks = tasks;
      getResult.Item.updatedAt = new Date().toISOString();
      await docClient.send(new PutCommand({ TableName: WORKSPACES_TABLE, Item: getResult.Item }));
    }
  }
}

export function createWorkspaceTools(vendorId) {
  const listWorkspaces = new DynamicStructuredTool({
    name: 'listWorkspaces',
    description:
      'List all workspaces belonging to this vendor. Returns workspace names, IDs, task counts, and status. Use this first when the user asks about tasks or workspaces without specifying which one.',
    schema: z.object({
      status: z
        .string()
        .optional()
        .describe('Optional filter: "active", "archived", or "all" (default: "all")'),
    }),
    func: async ({ status }) => {
      try {
        console.log(`[AI][WorkspaceTool] listWorkspaces called for vendorId="${vendorId}", status="${status || 'all'}"`);

        // Query 1: Workspaces owned by this vendor (vendorId field matches)
        const ownedResult = await docClient.send(
          new ScanCommand({
            TableName: WORKSPACES_TABLE,
            FilterExpression: 'vendorId = :vid',
            ExpressionAttributeValues: { ':vid': vendorId },
          })
        );
        console.log(`[AI][WorkspaceTool] Owned workspaces scan returned ${(ownedResult.Items || []).length} items`);

        // Query 2: Collaborative workspaces where vendor is in sharedWith list
        const sharedResult = await docClient.send(
          new ScanCommand({
            TableName: WORKSPACES_TABLE,
            FilterExpression: 'contains(sharedWith, :vid)',
            ExpressionAttributeValues: { ':vid': vendorId },
          })
        );
        console.log(`[AI][WorkspaceTool] Shared workspaces scan returned ${(sharedResult.Items || []).length} items`);

        // Merge and deduplicate by workspaceId
        const allItems = [...(ownedResult.Items || []), ...(sharedResult.Items || [])];
        const seen = new Set();
        let workspaces = [];
        for (const item of allItems) {
          const id = item.workspaceId;
          if (!seen.has(id)) {
            seen.add(id);
            workspaces.push(item);
          }
        }

        console.log(`[AI][WorkspaceTool] Total unique workspaces after merge: ${workspaces.length}`);
        if (workspaces.length > 0) {
          console.log(`[AI][WorkspaceTool] First workspace sample:`, JSON.stringify({
            workspaceId: workspaces[0].workspaceId,
            title: workspaces[0].title,
            vendorId: workspaces[0].vendorId,
            status: workspaces[0].status,
            taskCount: (workspaces[0].tasks || []).length,
            sharedWith: workspaces[0].sharedWith,
          }));
        }

        if (status && status !== 'all') {
          workspaces = workspaces.filter((w) => (w.status || 'active') === status);
        }

        if (workspaces.length === 0) {
          return JSON.stringify({ message: 'No workspaces found for this vendor.', count: 0, workspaces: [] });
        }

        const summary = workspaces.map((w) => {
          const tasks = w.tasks || [];
          return {
            workspaceId: w.workspaceId,
            title: w.title || 'Untitled',
            status: w.status || 'active',
            totalTasks: tasks.length,
            pendingTasks: tasks.filter((t) => t.status === 'pending' || t.status === 'todo').length,
            inProgressTasks: tasks.filter((t) => t.status === 'in-progress' || t.status === 'inProgress').length,
            completedTasks: tasks.filter((t) => t.status === 'completed' || t.status === 'done').length,
            createdAt: w.createdAt,
          };
        });

        console.log(`[AI][WorkspaceTool] Returning ${summary.length} workspaces`);
        return JSON.stringify({ count: summary.length, workspaces: summary });
      } catch (err) {
        console.error(`[AI][WorkspaceTool] Error:`, err);
        return JSON.stringify({ error: err.message });
      }
    },
  });

  const getWorkspaceTasks = new DynamicStructuredTool({
    name: 'getWorkspaceTasks',
    description:
      'Get tasks from a specific workspace. Can filter by status. Returns task names, statuses, assignees, and due dates.',
    schema: z.object({
      workspaceId: z.string().describe('The workspace ID to query tasks from'),
      status: z
        .string()
        .optional()
        .describe('Optional filter: "pending", "in-progress", "completed", "todo", "done", or "all"'),
    }),
    func: async ({ workspaceId, status }) => {
      try {
        console.log(`[AI][WorkspaceTool] getWorkspaceTasks called for workspace="${workspaceId}", vendorId="${vendorId}", status="${status || 'all'}"`);

        const result = await docClient.send(
          new GetCommand({
            TableName: WORKSPACES_TABLE,
            Key: { workspaceId },
          })
        );
        const ws = result.Item;
        if (!ws) {
          console.log(`[AI][WorkspaceTool] Workspace "${workspaceId}" not found`);
          return JSON.stringify({ error: 'Workspace not found' });
        }

        // Check access: vendor must be owner OR in sharedWith
        const isOwner = ws.vendorId === vendorId;
        const isShared = (ws.sharedWith || []).includes(vendorId);
        const isCollaborator = ws.accessControl?.collaborators?.includes(vendorId);
        console.log(`[AI][WorkspaceTool] Access check — isOwner=${isOwner}, isShared=${isShared}, isCollaborator=${isCollaborator}`);

        if (!isOwner && !isShared && !isCollaborator) {
          return JSON.stringify({ error: 'Access denied — workspace does not belong to this vendor' });
        }

        let tasks = ws.tasks || [];
        console.log(`[AI][WorkspaceTool] Found ${tasks.length} total tasks in workspace "${ws.title}"`);

        if (status && status !== 'all') {
          tasks = tasks.filter(
            (t) => t.status?.toLowerCase() === status.toLowerCase()
          );
        }

        const taskSummary = tasks.map((t) => ({
          taskId: t.taskId || t.id,
          name: t.name || t.title || 'Untitled task',
          status: t.status || 'unknown',
          assignee: t.assignee || t.assignedTo || 'Unassigned',
          dueDate: t.dueDate || null,
          priority: t.priority || 'normal',
          subtaskCount: (t.subtasks || []).length,
        }));

        return JSON.stringify({
          workspaceId,
          workspaceTitle: ws.title,
          totalTasks: taskSummary.length,
          tasks: taskSummary,
        });
      } catch (err) {
        console.error(`[AI][WorkspaceTool] getWorkspaceTasks error:`, err);
        return JSON.stringify({ error: err.message });
      }
    },
  });

  // ── Create Task in Workspace ──────────────────────────────────────────────
  const createTaskInWorkspace = new DynamicStructuredTool({
    name: 'createTaskInWorkspace',
    description:
      'Create a new task in a specific workspace. Use this when the user says "add a task", "create a task", or similar. You MUST know the workspaceId first — if the user gives a workspace name, use listWorkspaces first to find the ID. Returns the created task details and an action to open the workspace.',
    schema: z.object({
      workspaceId: z.string().describe('The workspace ID to create the task in'),
      name: z.string().describe('The task name/title'),
      description: z.string().optional().describe('Optional task description'),
      priority: z.enum(['low', 'medium', 'high']).optional().describe('Task priority (default: medium)'),
      dueDate: z.string().optional().describe('Optional due date in ISO format (YYYY-MM-DD)'),
    }),
    func: async ({ workspaceId, name, description, priority, dueDate }) => {
      try {
        console.log(`[AI][WorkspaceTool] createTaskInWorkspace — workspace="${workspaceId}", name="${name}", vendor="${vendorId}"`);

        // Fetch workspace
        const result = await docClient.send(
          new GetCommand({ TableName: WORKSPACES_TABLE, Key: { workspaceId } })
        );
        const ws = result.Item;
        if (!ws) return JSON.stringify({ error: 'Workspace not found' });

        // Check access
        const isOwner = ws.vendorId === vendorId;
        const isShared = (ws.sharedWith || []).includes(vendorId);
        if (!isOwner && !isShared) {
          return JSON.stringify({ error: 'Access denied — workspace does not belong to this vendor' });
        }

        // Check if workspace is locked
        const isCompleted = ws.status === 'project completed' || ws.status === 'completed' || ws.project_status === 'completed';
        if (isCompleted) {
          return JSON.stringify({ error: 'Workspace is locked (project completed). Cannot add tasks.' });
        }

        // Create the task
        const newTask = {
          id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: name || 'Untitled Task',
          description: description || '',
          priority: priority || 'medium',
          status: 'active',
          dueDate: dueDate || null,
          assignedUsers: 1,
          color: 'bg-blue-500',
          subtasks: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const updatedTasks = [...(ws.tasks || []), newTask];
        await updateWorkspaceTasks(workspaceId, updatedTasks);

        console.log(`[AI][WorkspaceTool] Task created: ${newTask.id} in workspace "${ws.title}"`);

        return JSON.stringify({
          success: true,
          message: `Task "${name}" created successfully in workspace "${ws.title}"`,
          task: {
            taskId: newTask.id,
            name: newTask.name,
            description: newTask.description,
            priority: newTask.priority,
            status: newTask.status,
            dueDate: newTask.dueDate,
          },
          workspace: {
            workspaceId: ws.workspaceId,
            title: ws.title,
          },
          __action: {
            type: 'OPEN_WORKSPACE',
            workspaceId: ws.workspaceId,
            workspaceTitle: ws.title,
          },
        });
      } catch (err) {
        console.error(`[AI][WorkspaceTool] createTaskInWorkspace error:`, err);
        return JSON.stringify({ error: err.message });
      }
    },
  });

  // ── Add Subtask to Task ──────────────────────────────────────────────────
  const addSubtaskToTask = new DynamicStructuredTool({
    name: 'addSubtaskToTask',
    description:
      'Add a subtask to an existing task in a workspace. Use this after creating a task when the user wants to add subtasks. Requires both workspaceId and taskId.',
    schema: z.object({
      workspaceId: z.string().describe('The workspace ID containing the task'),
      taskId: z.string().describe('The task ID to add the subtask to'),
      name: z.string().describe('The subtask name/title'),
      description: z.string().optional().describe('Optional subtask description'),
    }),
    func: async ({ workspaceId, taskId, name, description }) => {
      try {
        console.log(`[AI][WorkspaceTool] addSubtaskToTask — workspace="${workspaceId}", task="${taskId}", subtask="${name}"`);

        // Fetch workspace
        const result = await docClient.send(
          new GetCommand({ TableName: WORKSPACES_TABLE, Key: { workspaceId } })
        );
        const ws = result.Item;
        if (!ws) return JSON.stringify({ error: 'Workspace not found' });

        // Check access
        const isOwner = ws.vendorId === vendorId;
        const isShared = (ws.sharedWith || []).includes(vendorId);
        if (!isOwner && !isShared) {
          return JSON.stringify({ error: 'Access denied — workspace does not belong to this vendor' });
        }

        // Check if workspace is locked
        const isCompleted = ws.status === 'project completed' || ws.status === 'completed' || ws.project_status === 'completed';
        if (isCompleted) {
          return JSON.stringify({ error: 'Workspace is locked (project completed). Cannot add subtasks.' });
        }

        // Find the task
        const tasks = [...(ws.tasks || [])];
        const taskIndex = tasks.findIndex((t) => t.id === taskId);
        if (taskIndex === -1) return JSON.stringify({ error: `Task "${taskId}" not found in this workspace` });

        // Create subtask
        const newSubtask = {
          id: `subtask_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: name || 'Untitled Subtask',
          description: description || '',
          status: 'active',
          assignedUsers: 1,
          color: 'bg-gray-400',
          canvasData: { nodes: [], edges: [], zoomLevel: 100 },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        tasks[taskIndex].subtasks = [...(tasks[taskIndex].subtasks || []), newSubtask];
        tasks[taskIndex].updatedAt = new Date().toISOString();

        await updateWorkspaceTasks(workspaceId, tasks);

        console.log(`[AI][WorkspaceTool] Subtask created: ${newSubtask.id} under task "${tasks[taskIndex].name}"`);

        return JSON.stringify({
          success: true,
          message: `Subtask "${name}" added to task "${tasks[taskIndex].name}"`,
          subtask: {
            subtaskId: newSubtask.id,
            name: newSubtask.name,
            description: newSubtask.description,
            status: newSubtask.status,
          },
          parentTask: {
            taskId: tasks[taskIndex].id,
            name: tasks[taskIndex].name,
            totalSubtasks: tasks[taskIndex].subtasks.length,
          },
          workspace: {
            workspaceId: ws.workspaceId,
            title: ws.title,
          },
          __action: {
            type: 'OPEN_WORKSPACE',
            workspaceId: ws.workspaceId,
            workspaceTitle: ws.title,
          },
        });
      } catch (err) {
        console.error(`[AI][WorkspaceTool] addSubtaskToTask error:`, err);
        return JSON.stringify({ error: err.message });
      }
    },
  });

  return [listWorkspaces, getWorkspaceTasks, createTaskInWorkspace, addSubtaskToTask];
}