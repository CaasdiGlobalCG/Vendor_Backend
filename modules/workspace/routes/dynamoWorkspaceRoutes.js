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

const router = express.Router();

router.use(authenticateCognitoJwt);
router.use(attachVendorId);
router.use(attachRBAC);

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
router.get('/workspace-access/status/:workspaceId', requirePermission('workspace', 'view'), getWorkspaceAccessStatus);
router.get('/workspace-access/verify/:workspaceId', requirePermission('workspace', 'view'), verifyWorkspaceAccess);

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

export default router;
