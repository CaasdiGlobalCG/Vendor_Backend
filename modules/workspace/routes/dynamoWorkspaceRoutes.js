import express from 'express';
import * as dynamoWorkspaceController from '../controllers/dynamoWorkspaceController.js';
import { getWorkspaceAccessStatus, verifyWorkspaceAccess } from '../controllers/workspaceAccessController.js';
import { inviteCASMembersToWorkspace } from '../../pm/controllers/pmProjectController.js';
import { getWorkspacePurchaseOrders } from '../controllers/workspacePurchaseOrdersController.js';

const router = express.Router();

// Create a new workspace
router.post('/workspaces', dynamoWorkspaceController.createWorkspace);

// Get workspace by ID
router.get('/workspaces/:id', dynamoWorkspaceController.getWorkspaceById);

// Get workspace by lead ID
router.get('/workspaces/lead/:leadId', dynamoWorkspaceController.getWorkspaceByLeadId);

// Get workspace by project ID
router.get('/workspaces/project/:projectId', dynamoWorkspaceController.getWorkspaceByProjectId);

// Get workspaces by vendor ID
router.get('/workspaces/vendor/:vendorId', dynamoWorkspaceController.getWorkspacesByVendorId);

// Get workspace collaborators with details and activity
router.get('/workspaces/:workspaceId/collaborators', dynamoWorkspaceController.getWorkspaceCollaborators);

// Update workspace permissions
router.put('/workspaces/:workspaceId/permissions', dynamoWorkspaceController.updateWorkspacePermissions);

// Access status and verification
router.get('/workspace-access/status/:workspaceId', getWorkspaceAccessStatus);
router.get('/workspace-access/verify/:workspaceId', verifyWorkspaceAccess);

// Purchase orders for a vendor (fallback route under dynamo workspace router)
// This ensures /api/workspace/purchase-orders works even if workspaceRoutes
// are not mounted in some environments.
router.get('/workspace/purchase-orders', getWorkspacePurchaseOrders);

// Create or get workspace for a lead/project
router.post('/workspaces/lead/:leadId/create-or-get', dynamoWorkspaceController.createOrGetWorkspaceForLead);

// Update a workspace
router.put('/workspaces/:id', dynamoWorkspaceController.updateWorkspace);

// Save workspace canvas data (specialized endpoint for canvas state)
router.put('/workspaces/:id/canvas', dynamoWorkspaceController.saveWorkspaceCanvas);

// Share workspace with other users
router.put('/workspaces/:id/share', dynamoWorkspaceController.shareWorkspace);

// Invite CAS members to workspace
router.post('/workspaces/:workspaceId/invite-cas', inviteCASMembersToWorkspace);

// Get workspaces where user is a CAS collaborator
router.get('/cas-member/:userId/workspaces', async (req, res) => {
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
router.post('/workspaces/:id/tasks', dynamoWorkspaceController.addTaskToWorkspace);
router.post('/workspaces/:id/tasks/:taskId/subtasks', dynamoWorkspaceController.addSubtaskToTask);
router.put('/workspaces/:id/tasks/:taskId/subtasks/:subtaskId/canvas', dynamoWorkspaceController.updateSubtaskCanvas);

// Delete a workspace
router.delete('/workspaces/:id', dynamoWorkspaceController.deleteWorkspace);

export default router;
