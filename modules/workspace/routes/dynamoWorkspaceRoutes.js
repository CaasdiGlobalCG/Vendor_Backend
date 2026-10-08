import express from 'express';
import * as dynamoWorkspaceController from '../controllers/dynamoWorkspaceController.js';
import { getWorkspaceAccessStatus, verifyWorkspaceAccess } from '../controllers/workspaceAccessController.js';
import { inviteCASMembersToWorkspace } from '../../pm/controllers/pmProjectController.js';
import { getWorkspaceMemberAccess, updateWorkspaceMemberAccess } from '../../rbac/controllers/resourceAssignmentController.js';
import { getWorkspacePurchaseOrders } from '../controllers/workspacePurchaseOrdersController.js';
import { authenticateCognitoJwt } from '../../../middleware/cognitoJwtMiddleware.js';
import { attachVendorId } from '../../../middleware/attachVendorId.js';
import { attachRBAC } from '../../rbac/middleware/attachRBAC.js';
import { requirePermission } from '../../rbac/middleware/requirePermission.js';
import aiConfig from '../../ai/config/aiConfig.js';
import { ChatBedrockConverse } from '@langchain/aws';

const router = express.Router();

// Scope auth + RBAC only to workspace-related paths.
// This router is mounted at /api so a bare router.use() bleeds into all
// /api/* routes (including /api/vendor/*). Scoping prevents that.
const authChain = [authenticateCognitoJwt, attachVendorId, attachRBAC];
router.use('/workspaces', ...authChain);     // /api/workspaces/*
router.use('/workspace-access', ...authChain); // /api/workspace-access/*
router.use('/workspace', ...authChain);      // /api/workspace/*
router.use('/cas-member', ...authChain);     // /api/cas-member/*

// Create a new workspace
router.post('/workspaces', requirePermission('workspace', 'create'), dynamoWorkspaceController.createWorkspace);

// Get workspace by ID
router.get('/workspaces/:id', requirePermission('workspace', 'view'), dynamoWorkspaceController.getWorkspaceById);

// Get direct member assignment state for a workspace
router.get('/workspaces/:id/member-access', requirePermission('workspace', 'view'), getWorkspaceMemberAccess);

// Add/remove direct member access for a workspace
router.patch('/workspaces/:id/member-access', requirePermission('workspace', 'edit'), updateWorkspaceMemberAccess);

// Get workspace by lead ID
router.get('/workspaces/lead/:leadId', requirePermission('workspace', 'view'), dynamoWorkspaceController.getWorkspaceByLeadId);

// Get workspace by project ID
router.get('/workspaces/project/:projectId', requirePermission('workspace', 'view'), dynamoWorkspaceController.getWorkspaceByProjectId);

// Get workspaces by vendor ID
router.get('/workspaces/vendor/:vendorId', requirePermission('workspace', 'view'), dynamoWorkspaceController.getWorkspacesByVendorId);

// Get workspace collaborators with details and activity
router.get('/workspaces/:workspaceId/collaborators', requirePermission('workspace', 'view'), dynamoWorkspaceController.getWorkspaceCollaborators);

// Update workspace permissions
router.put('/workspaces/:workspaceId/permissions', requirePermission('workspace', 'edit'), dynamoWorkspaceController.updateWorkspacePermissions);

// Request project completion (vendor submits, PM and Client approvals trigger status change)
router.post('/workspaces/:workspaceId/request-completion', requirePermission('workspace', 'edit'), dynamoWorkspaceController.requestProjectCompletion);

// Access status and verification
// For userType=client the workspace's own accessControl/sharedWith lists are the
// gate — vendor-org RBAC scope doesn't apply to client users.
const requireWorkspaceViewUnlessClient = (req, res, next) => {
  if (req.query.userType === 'client') return next();
  return requirePermission('workspace', 'view')(req, res, next);
};
router.get('/workspace-access/status/:workspaceId', requireWorkspaceViewUnlessClient, getWorkspaceAccessStatus);
router.get('/workspace-access/verify/:workspaceId', requireWorkspaceViewUnlessClient, verifyWorkspaceAccess);

// Purchase orders for a vendor (fallback route under dynamo workspace router)
// This ensures /api/workspace/purchase-orders works even if workspaceRoutes
// are not mounted in some environments.
router.get('/workspace/purchase-orders', requirePermission('workspace', 'view'), getWorkspacePurchaseOrders);

// Create or get workspace for a lead/project
router.post('/workspaces/lead/:leadId/create-or-get', requirePermission('workspace', 'create'), dynamoWorkspaceController.createOrGetWorkspaceForLead);

// Update a workspace
router.put('/workspaces/:id', requirePermission('workspace', 'edit'), dynamoWorkspaceController.updateWorkspace);

// Save workspace canvas data (specialized endpoint for canvas state)
router.put('/workspaces/:id/canvas', requirePermission('workspace', 'edit'), dynamoWorkspaceController.saveWorkspaceCanvas);

// Share workspace with other users
router.put('/workspaces/:id/share', requirePermission('workspace', 'edit'), dynamoWorkspaceController.shareWorkspace);

// Invite CAS members to workspace
router.post('/workspaces/:workspaceId/invite-cas', requirePermission('workspace', 'edit'), inviteCASMembersToWorkspace);

// Invite vendors to collaborate on workspace (permission-scoped access)
router.post('/workspaces/:workspaceId/invite-vendors', requirePermission('workspace', 'edit'), dynamoWorkspaceController.inviteVendorsToWorkspace);

// Get workspaces where user is a CAS collaborator
router.get('/cas-member/:userId/workspaces', requirePermission('workspace', 'view'), async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log('🔍 Fetching workspaces for CAS member:', userId);
    
    const { dynamoDB, WORKSPACES_TABLE } = await import('../../../config/aws.js');
    
    // Scan all workspaces to find ones where the user is a CAS collaborator
    const params = {
      TableName: WORKSPACES_TABLE
    };
    
    const result = await dynamoDB.scan(params).promise();
    
    console.log(`📊 Found ${result.Items.length} workspaces with casCollaborators`);
    
    // Filter and format the workspaces
    const userWorkspaces = result.Items.filter(workspace => {
      const casCollaborators = workspace.casCollaborators || [];
      console.log(`🔍 Workspace ${workspace.id || workspace.workspaceId}: ${casCollaborators.length} collaborators`);
      if (casCollaborators.length > 0) {
        console.log('   Collaborator IDs:', casCollaborators.map(c => c.userId));
        console.log('   Looking for userId:', userId);
      }
      const hasAccess = casCollaborators.some(collaborator => {
        console.log(`   Comparing: "${collaborator.userId}" === "${userId}" = ${collaborator.userId === userId}`);
        return collaborator.userId === userId;
      });
      console.log(`   Access result for workspace: ${hasAccess}`);
      return hasAccess;
    }).map(workspace => {
      const userCollaboration = workspace.casCollaborators.find(c => c.userId === userId);
      return {
        workspaceId: workspace.workspaceId || workspace.id,
        title: workspace.title,
        description: workspace.description,
        status: workspace.status,
        invitedAt: userCollaboration?.invitedAt,
        accessLevel: userCollaboration?.accessLevel,
        casUnit: userCollaboration?.casUnit,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt
      };
    });
    
    console.log(`✅ Found ${userWorkspaces.length} workspaces for CAS member ${userId}`);
    
    res.status(200).json({
      success: true,
      workspaces: userWorkspaces,
      count: userWorkspaces.length
    });
    
  } catch (error) {
    console.error('❌ Error fetching CAS member workspaces:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invited workspaces',
      error: error.message
    });
  }
});

// Task management within workspace

router.post('/workspaces/:id/tasks', requirePermission('workspace', 'edit'), dynamoWorkspaceController.addTaskToWorkspace);
router.post('/workspaces/:id/tasks/:taskId/subtasks', requirePermission('workspace', 'edit'), dynamoWorkspaceController.addSubtaskToTask);
router.patch('/workspaces/:id/tasks/:taskId', dynamoWorkspaceController.updateTaskInWorkspace);
router.patch('/workspaces/:id/tasks/:taskId/subtasks/:subtaskId', dynamoWorkspaceController.updateSubtaskInTask);
router.put('/workspaces/:id/tasks/:taskId/subtasks/:subtaskId/canvas', requirePermission('workspace', 'edit'), dynamoWorkspaceController.updateSubtaskCanvas);


// Delete a workspace
router.delete('/workspaces/:id', requirePermission('workspace', 'delete'), dynamoWorkspaceController.deleteWorkspace);

// ── Comment @mention notifications ──
router.post('/workspace/comments/mention', requirePermission('workspace', 'view'), async (req, res) => {
  try {
    const { workspaceId, nodeId, elementName, commentText, authorName, mentionedUserIds } = req.body;
    if (!mentionedUserIds || mentionedUserIds.length === 0) {
      return res.status(200).json({ success: true, message: 'No mentions to notify' });
    }

    // Dynamic import to avoid circular deps
    const { sendNotificationToUser } = await import('../../../websocket/notificationSocket.js');
    const { createNotification } = await import('../../../models/DynamoNotification.js');

    const results = [];
    for (const userId of mentionedUserIds) {
      // Persist to DynamoDB
      try {
        await createNotification({
          userId,
          userType: 'vendor',
          type: 'comment_mention',
          title: `${authorName} mentioned you in a comment`,
          message: commentText.length > 120 ? commentText.slice(0, 120) + '…' : commentText,
          relatedId: workspaceId,
          relatedType: 'workspace',
        });
      } catch (dbErr) {
        console.error(`Failed to persist mention notification for ${userId}:`, dbErr);
      }

      // Real-time WS push
      try {
        sendNotificationToUser(userId, {
          id: `mention_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'comment_mention',
          title: `${authorName} mentioned you`,
          message: commentText.length > 120 ? commentText.slice(0, 120) + '…' : commentText,
          data: { workspaceId, nodeId, elementName },
          timestamp: new Date().toISOString(),
          priority: 'medium',
          actionRequired: false,
          actions: [{ type: 'navigate', label: 'View Comment', url: `/workspace/${workspaceId}` }],
        });
      } catch (wsErr) {
        console.error(`Failed to send WS mention notification for ${userId}:`, wsErr);
      }
      results.push(userId);
    }

    res.status(200).json({ success: true, notified: results });
  } catch (error) {
    console.error('Error sending mention notifications:', error);
    res.status(500).json({ success: false, message: 'Failed to send notifications' });
  }
});

// ── Generic collaborator notifications ──
// Lets workspace participants notify other members by role (pm / vendor /
// client) — e.g. approval requests, approval results, deletion requests.
router.post('/workspaces/:id/notify', requirePermission('workspace', 'view'), async (req, res) => {
  try {
    const { roles = ['pm', 'vendor', 'client'], excludeUserId, notification = {}, targetUserIds = [] } = req.body;
    const workspaceId = req.params.id;

    const workspaceModel = await import('../models/DynamoWorkspace.js');
    const workspace = await workspaceModel.getWorkspaceById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    const owner = workspace.accessControl?.owner;
    const clientId = workspace.projectMetadata?.clientId || workspace.clientId || workspace.accessControl?.clientId;
    const collaborators = workspace.accessControl?.collaborators || [];

    const userIds = new Set();
    if (roles.includes('pm') && owner) userIds.add(owner);
    if (roles.includes('client') && clientId) userIds.add(clientId);
    if (roles.includes('vendor')) {
      collaborators.forEach((id) => {
        if (id && id !== clientId && id !== owner) userIds.add(id);
      });
    }
    // Explicit per-user targets (e.g. calendar "selected people" visibility)
    (Array.isArray(targetUserIds) ? targetUserIds : []).forEach((id) => {
      if (id) userIds.add(id);
    });
    if (excludeUserId) userIds.delete(excludeUserId);

    const { sendNotificationToUser } = await import('../../../websocket/notificationSocket.js');
    const { createNotification } = await import('../../../models/DynamoNotification.js');

    const notified = [];
    for (const userId of userIds) {
      let persistedId = null;
      try {
        const saved = await createNotification({
          userId,
          userType: userId === clientId ? 'client' : userId === owner ? 'pm' : 'vendor',
          type: notification.type || 'workspace_event',
          title: notification.title || 'Workspace update',
          message: notification.message || '',
          relatedId: workspaceId,
          relatedType: 'workspace',
        });
        persistedId = saved?.notificationId || null;
      } catch (dbErr) {
        console.error(`Failed to persist notification for ${userId}:`, dbErr);
      }

      try {
        sendNotificationToUser(userId, {
          id: persistedId || `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          notificationId: persistedId,
          type: notification.type || 'workspace_event',
          title: notification.title || 'Workspace update',
          message: notification.message || '',
          data: { workspaceId, ...(notification.data || {}) },
          timestamp: new Date().toISOString(),
          priority: notification.priority || 'medium',
          actionRequired: notification.actionRequired || false,
          actions: notification.actions || [
            { type: 'navigate', label: 'Open Workspace', url: `/VendorDashboard/workspace/${workspaceId}` }
          ],
        });
      } catch (wsErr) {
        console.error(`Failed to send WS notification for ${userId}:`, wsErr);
      }
      notified.push(userId);
    }

    res.status(200).json({ success: true, notified });
  } catch (error) {
    console.error('Error sending workspace notifications:', error);
    res.status(500).json({ success: false, message: 'Failed to send notifications' });
  }
});

// ---------------------------------------------------------------
// AI canvas assist — Smart Note actions + AI Helper node.
// Mounted via router.use('/workspace', authChain) so it's already
// authenticated (Cognito or external PM/CAS session).
// Uses AWS Bedrock Nova (same provider as the AI chat module).
// ---------------------------------------------------------------
const AI_ACTION_PROMPTS = {
  summarize: (prompt) => ({
    system:
      'You are a concise assistant inside a project workspace. Summarize the given note in 2-5 short bullet points. Return only the summary text, no preamble.',
    user: prompt,
    json: false,
  }),
  extract: (prompt) => ({
    system:
      'Extract key information from the workspace note. Reply with ONLY a JSON object (no markdown fences) shaped: {"dates":[],"people":[],"amounts":[],"actionItems":[]}. Keep each entry under 12 words.',
    user: prompt,
    json: true,
  }),
  suggest: (_prompt, context) => ({
    system:
      `You suggest next steps for a workspace canvas that currently has ` +
      `${context?.edgeCount || 0} connections and elements: ` +
      `${(context?.nodeNames || []).join(', ') || 'none'}. ` +
      `Task: ${context?.taskName || 'general'}${context?.subtaskName ? ` / ${context.subtaskName}` : ''}. ` +
      'Give 3-5 short actionable suggestions, one per line.',
    user: 'Suggest next steps.',
    json: false,
  }),
  generate: (prompt) => ({
    system:
      'You generate workspace canvas flows from a request. Return a compact text plan: numbered steps, each naming an element type (form, table, chart, task-card, approval-board, smart-note) and its purpose.',
    user: prompt,
    json: false,
  }),
  ask: (prompt) => ({
    system:
      'You are an assistant inside a construction project workspace. The user prompt starts with a serialized description of the canvas elements, followed by "Question:" and their question. Answer concisely from the context. If the answer is not in the context, say so plainly.',
    user: prompt,
    json: false,
  }),
  materialSpec: (prompt) => ({
    system:
      'You generate a technical material specification sheet for construction/procurement. Reply with ONLY a JSON object (no markdown fences) shaped: {"name":"","category":"","grade":"","standard":"","unit":"","specs":[{"key":"","value":""}]}. specs: 5-8 typical required properties; each value is a required spec like "\u2265 3.5" or "Zone II" or "600 \u00d7 600". Cite the relevant Indian IS standard(s) in "standard" where applicable.',
    user: prompt,
    json: true,
  }),
};

router.post('/workspace/ai/assist', async (req, res) => {
  try {
    const { action, prompt = '', context } = req.body || {};
    const builder = AI_ACTION_PROMPTS[action];
    if (!builder) {
      return res.status(400).json({ success: false, message: `Unknown action: ${action}` });
    }
    if (!prompt?.trim() && (action === 'summarize' || action === 'extract' || action === 'generate' || action === 'ask' || action === 'materialSpec')) {
      return res.status(400).json({ success: false, message: 'prompt is required' });
    }

    const spec = builder(prompt.trim(), context);
    const llm = new ChatBedrockConverse({
      model: aiConfig.bedrock.model,
      region: aiConfig.bedrock.region,
      temperature: 0.3,
      maxTokens: 800,
      maxRetries: 2,
    });

    const aiResp = await llm.invoke([
      ['system', spec.system],
      ['user', spec.user],
    ]);
    const text = (
      typeof aiResp.content === 'string'
        ? aiResp.content
        : (aiResp.content || []).map((c) => c?.text || '').join('')
    ).trim();

    let data;
    if (spec.json && text) {
      try {
        data = JSON.parse(text.replace(/```json|```/g, '').trim());
      } catch {
        console.warn('AI assist: failed to parse JSON response:', text);
      }
    }

    res.json({ success: true, text, data });
  } catch (error) {
    console.error('AI assist error:', error);
    res.status(500).json({ success: false, message: 'AI assist failed' });
  }
});

export default router;
