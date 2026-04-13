import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { dynamoDB } from '../../../config/aws.js';
import * as DynamoWorkspace from '../models/DynamoWorkspace.js';
import { canAccessProject, canAccessWorkspace } from '../../rbac/utils/scopeAccess.utils.js';

const LEAD_INVITATIONS_TABLE = 'lead_invitations_table';
const PM_PROJECTS_TABLE = 'pm_projects_table';
import { WORKSPACES_TABLE } from '../../../config/aws.js';

/**
 * Get workspace access status for user
 */
export const getWorkspaceAccessStatus = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { userId, userType } = req.query;

    console.log('🔍 Getting workspace access status:', { workspaceId, userId, userType });

    // Get workspace details via model (resolves by workspaceId|projectId|id)
    const workspaceItem = await DynamoWorkspace.getWorkspaceById(workspaceId);

    if (!workspaceItem) {
      return res.status(404).json({
        success: false,
        error: 'Workspace not found'
      });
    }

    if (!canAccessWorkspace(req.rbac, workspaceItem.workspaceId || workspaceId, workspaceItem.projectId)) {
      return res.status(403).json({ success: false, error: 'Access denied for this workspace' });
    }

    const workspaceData = workspaceItem;
    const accessLevel = getUserAccessLevel(workspaceData, userId, userType);
    const permissions = getPermissionsForUser(workspaceData, userId, userType);

    res.json({
      success: true,
      workspaceId,
      accessLevel,
      permissions,
      hasAccess: accessLevel !== 'no_access'
    });

  } catch (error) {
    console.error('❌ Error getting workspace access status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get workspace access status'
    });
  }
};

/**
 * Verify workspace access based on PM lead approval
 * Only approved PM-Vendor pairs can access collaborative workspaces
 */
export const verifyWorkspaceAccess = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { userId, userType } = req.query; // pm or vendor

    console.log('🔐 Verifying workspace access:', { workspaceId, userId, userType });

    // Get workspace details via model (resolves by workspaceId|projectId|id)
    const workspace = await DynamoWorkspace.getWorkspaceById(workspaceId);

    if (!workspace) {
      return res.status(404).json({
        success: false,
        error: 'Workspace not found'
      });
    }

    if (!canAccessWorkspace(req.rbac, workspace.workspaceId || workspaceId, workspace.projectId)) {
      return res.status(403).json({ success: false, error: 'Access denied for this workspace' });
    }

    const workspaceData = workspace;
    console.log('📋 Workspace found:', workspaceData.projectId);

    // For PM-Vendor workspaces, verify lead approval
    if (userType === 'vendor') {
      const accessGranted = await verifyPMVendorApproval(
        workspaceData.projectId,
        workspaceData.accessControl?.owner,
        userId
      );

      if (!accessGranted) {
        return res.status(403).json({
          success: false,
          error: 'Access denied. PM approval required.',
          accessLevel: 'denied'
        });
      }
    }

    // Determine user's access level
    const accessLevel = getUserAccessLevel(workspaceData, userId, userType);

    res.json({
      success: true,
      workspaceId,
      accessLevel,
      permissions: getPermissionsForUser(workspaceData, userId, userType),
      workspace: workspaceData
    });

  } catch (error) {
    console.error('❌ Error verifying workspace access:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify workspace access'
    });
  }
};

/**
 * Verify PM-Vendor approval for workspace access
 */
async function verifyPMVendorApproval(projectId, pmId, vendorId) {
  try {
    console.log('🔍 Verifying PM-Vendor approval:', { projectId, pmId, vendorId });

    // First, check if there's an existing workspace where the vendor is already invited
    const existingWorkspace = await findExistingWorkspace(projectId, pmId);
    if (existingWorkspace) {
      // Check if vendor is in sharedWith or collaborators list (PM already invited them)
      const isInvitedVendor = existingWorkspace.sharedWith?.includes(vendorId) || 
                             existingWorkspace.accessControl?.collaborators?.includes(vendorId);
      
      if (isInvitedVendor) {
        console.log('✅ Vendor is already invited to existing workspace');
        return true;
      }
    }

    // Check for approved leads between PM and Vendor for this project
    const leadResult = await dynamoDB.query({
      TableName: LEAD_INVITATIONS_TABLE,
      IndexName: 'ProjectIdIndex',
      KeyConditionExpression: 'projectId = :projectId',
      FilterExpression: 'pmId = :pmId AND vendorId = :vendorId AND #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':projectId': projectId,
        ':pmId': pmId,
        ':vendorId': vendorId,
        ':status': 'pm_approved'
      }
    }).promise();

    // Check if there's at least one approved lead with workspace access
    const approvedLeads = leadResult.Items.filter(lead => 
      lead.pmDecision?.approved && lead.pmDecision?.workspaceAccess
    );

    return approvedLeads.length > 0;
  } catch (error) {
    console.error('Error verifying PM-Vendor approval:', error);
    return false;
  }
}

/**
 * Determine user's access level in the workspace
 */
function getUserAccessLevel(workspace, userId, userType) {
  const accessControl = workspace.accessControl || {};
  
  if (userType === 'pm' && accessControl.owner === userId) {
    return 'pm_owner';
  }
  
  if (accessControl.collaborators?.includes(userId)) {
    return 'approved_vendor';
  }
  
  if (workspace.sharedWith?.includes(userId)) {
    return 'shared_access';
  }
  
  return 'no_access';
}

/**
 * Get permissions for user based on access level
 */
function getPermissionsForUser(workspace, userId, userType) {
  const accessControl = workspace.accessControl || {};
  const permissions = accessControl.permissions || {};
  
  return {
    canEdit: userType === 'pm' || permissions.canEdit?.includes(userId) || false,
    canComment: permissions.canComment?.includes(userId) || false,
    canViewFiles: permissions.canViewFiles?.includes(userId) || false,
    canCreateTasks: permissions.canCreateTasks?.includes(userId) || false,
    canAssignTasks: permissions.canAssignTasks?.includes(userId) || false,
    canUpdateTaskStatus: permissions.canUpdateTaskStatus?.includes(userId) || false,
    canInviteUsers: userType === 'pm' && accessControl.owner === userId
  };
}

/**
 * Create or get workspace for approved PM-Vendor collaboration
 */
export const createOrGetCollaborativeWorkspace = async (req, res) => {
  try {
    const { projectId, pmId, vendorId, leadId, pmApproved = false } = req.body;

    if (req.vendorId && String(req.vendorId) !== String(vendorId) && !req.rbac?.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'Cannot request workspace for another vendor' });
    }

    if (!canAccessProject(req.rbac, projectId)) {
      return res.status(403).json({ success: false, error: 'Access denied for this project' });
    }

    console.log('🏗️ Creating/getting collaborative workspace:', { projectId, pmId, vendorId, leadId, pmApproved });

    // First check if there's an existing workspace - if PM created it, vendor should have access
    console.log('🔍 Checking for existing PM workspace first...');
    const existingWorkspace = await findExistingWorkspace(projectId, pmId);
    
    if (!existingWorkspace) {
      // No existing workspace, verify PM approval for creating new one (unless PM explicitly approved)
      if (!pmApproved) {
        console.log('🔐 No existing workspace found, verifying PM-Vendor approval...');
        const accessGranted = await verifyPMVendorApproval(projectId, pmId, vendorId);
        
        if (!accessGranted) {
          console.log('❌ Access denied - PM approval required');
          return res.status(403).json({
            success: false,
            error: 'Workspace access denied. PM approval required.',
            requiresApproval: true
          });
        }
        console.log('✅ PM-Vendor approval verified for new workspace');
      } else {
        console.log('✅ PM explicitly approved vendor, skipping approval check');
      }
    }

    // Handle existing workspace case
    if (existingWorkspace) {
      if (!canAccessWorkspace(req.rbac, existingWorkspace.workspaceId || existingWorkspace.projectId, projectId)) {
        return res.status(403).json({ success: false, error: 'Access denied for this workspace' });
      }

      console.log('📝 Processing existing workspace access...');
      
      // Check if vendor is already in the workspace
      if (existingWorkspace.sharedWith?.includes(vendorId)) {
        console.log('✅ Vendor already has access to workspace');
        return res.json({
          success: true,
          workspace: existingWorkspace,
          message: 'Vendor already has access to collaborative workspace',
          isNew: false
        });
      }
      
      // If workspace exists but vendor is not in sharedWith, add them
      // This handles the case where PM created workspace but didn't invite vendors yet
      console.log('📝 Adding vendor to existing PM workspace...');
      const updatedWorkspace = await addVendorToWorkspace(existingWorkspace.workspaceId || existingWorkspace.projectId, vendorId);
      
      console.log('✅ Vendor added to existing workspace');
      return res.json({
        success: true,
        workspace: updatedWorkspace || existingWorkspace,
        message: 'Added to existing collaborative workspace',
        isNew: false
      });
    }

    // Create new collaborative workspace
    console.log('🏗️ Creating new collaborative workspace...');
    const workspace = await createNewCollaborativeWorkspace(projectId, pmId, vendorId, leadId);

    console.log('✅ New collaborative workspace created:', workspace.workspaceId);
    res.json({
      success: true,
      workspace,
      message: 'Collaborative workspace created successfully',
      isNew: true
    });

  } catch (error) {
    console.error('❌ Error creating collaborative workspace:', error);
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Failed to create collaborative workspace',
      details: error.message
    });
  }
};

/**
 * Find existing workspace for a project
 */
async function findExistingWorkspace(projectId, pmId) {
  try {
    console.log('🔍 Looking for existing workspace:', { projectId, pmId });
    
    // First, try to find workspace by projectId
    let workspace = await DynamoWorkspace.getWorkspaceByProjectId(projectId);
    
    if (workspace) {
      // Check if this workspace belongs to the PM (either as owner or vendorId for compatibility)
      const isPMWorkspace = workspace.accessControl?.owner === pmId || workspace.vendorId === pmId;
      
      if (isPMWorkspace) {
        console.log('✅ Found existing PM workspace by projectId:', workspace.workspaceId || workspace.projectId);
        return workspace;
      } else {
        console.log('⚠️ Found workspace by projectId but PM does not own it:', { 
          workspaceOwner: workspace.accessControl?.owner, 
          workspaceVendorId: workspace.vendorId,
          requestingPmId: pmId 
        });
      }
    }
    
    // If projectId might actually be a workspaceId, try that
    if (projectId && projectId.includes('-')) {
      console.log('🔍 Trying to find workspace by workspaceId (projectId might be workspaceId):', projectId);
      workspace = await DynamoWorkspace.getWorkspaceById(projectId);
      
      if (workspace) {
        const isPMWorkspace = workspace.accessControl?.owner === pmId || workspace.vendorId === pmId;
        
        if (isPMWorkspace) {
          console.log('✅ Found existing PM workspace by workspaceId:', workspace.workspaceId || workspace.projectId);
          return workspace;
        } else {
          console.log('⚠️ Found workspace by workspaceId but PM does not own it:', { 
            workspaceOwner: workspace.accessControl?.owner, 
            workspaceVendorId: workspace.vendorId,
            requestingPmId: pmId 
          });
        }
      }
    }
    
    // If no workspace found by projectId, try scanning for workspaces with this projectId and pmId
    console.log('🔍 Scanning for workspaces with projectId and pmId...');
    const allWorkspaces = await DynamoWorkspace.getWorkspacesByVendorId(pmId);
    
    for (const ws of allWorkspaces) {
      if (ws.projectId === projectId || ws.workspaceId === projectId) {
        console.log('✅ Found existing workspace via scan:', ws.workspaceId || ws.projectId);
        return ws;
      }
    }
    
    console.log('📭 No existing workspace found for project:', projectId, 'and PM:', pmId);
    return null;
  } catch (error) {
    console.error('Error finding existing workspace:', error);
    return null;
  }
}

/**
 * Add vendor to existing workspace
 */
async function addVendorToWorkspace(workspaceId, vendorId) {
  try {
    console.log('👥 Adding vendor to workspace:', { workspaceId, vendorId });
    
    // Get current workspace
    const currentWorkspace = await DynamoWorkspace.getWorkspaceById(workspaceId);
    if (!currentWorkspace) {
      throw new Error('Workspace not found');
    }

    // Prepare updates to add vendor
    const updates = {
      sharedWith: [...(currentWorkspace.sharedWith || []), vendorId],
      accessControl: {
        ...currentWorkspace.accessControl,
        collaborators: [...(currentWorkspace.accessControl?.collaborators || []), vendorId],
        permissions: {
          ...currentWorkspace.accessControl?.permissions,
          canComment: [...(currentWorkspace.accessControl?.permissions?.canComment || []), vendorId],
          canViewFiles: [...(currentWorkspace.accessControl?.permissions?.canViewFiles || []), vendorId],
          canUpdateTaskStatus: [...(currentWorkspace.accessControl?.permissions?.canUpdateTaskStatus || []), vendorId]
        }
      },
      updatedAt: new Date().toISOString()
    };

    // Update workspace using model
    const updatedWorkspace = await DynamoWorkspace.updateWorkspace(workspaceId, updates);

    console.log('✅ Vendor added to workspace successfully');
    return updatedWorkspace;
  } catch (error) {
    console.error('Error adding vendor to workspace:', error);
    throw error;
  }
}

/**
 * Create new collaborative workspace
 */
async function createNewCollaborativeWorkspace(projectId, pmId, vendorId, leadId) {
  try {
    console.log('🏗️ Creating new workspace for:', { projectId, pmId, vendorId });

    // Get project details
    const projectResult = await dynamoDB.get({
      TableName: PM_PROJECTS_TABLE,
      Key: { projectId }
    }).promise();

    const project = projectResult.Item;
    
    // Get clientId from project
    const clientId = project?.clientId || null;
    
    // Build sharedWith and collaborators list
    const sharedWithList = [vendorId];
    const collaboratorsList = [vendorId];
    
    if (clientId) {
      sharedWithList.push(clientId);
      collaboratorsList.push(clientId);
      console.log('✅ Added client to new collaborative workspace:', clientId);
    }
    
    const workspaceId = uuidv4();

    const workspaceData = {
      workspaceId,
      projectId,
      leadId: leadId || null,
      title: `${project?.name || 'Project'} - Collaborative Workspace`,
      description: `PM-Vendor collaborative workspace for ${project?.name || 'project'}`,
      
      // Set PM as owner, vendor and client as collaborators
      vendorId: pmId, // For compatibility with existing system
      isShared: true,
      sharedWith: sharedWithList,
      
      // RBAC settings
      accessControl: {
        owner: pmId,
        collaborators: collaboratorsList,
        permissions: {
          canEdit: [pmId], // Only PM can edit canvas
          canComment: [pmId, vendorId, ...(clientId ? [clientId] : [])], // All can comment
          canViewFiles: [pmId, vendorId, ...(clientId ? [clientId] : [])], // All can view files
          canCreateTasks: [pmId], // Only PM can create tasks
          canAssignTasks: [pmId], // Only PM can assign tasks
          canUpdateTaskStatus: [vendorId], // Only vendor can update task status
          canAddNotes: [vendorId, ...(clientId ? [clientId] : [])], // Vendor and client can add notes to elements
          canApproveElements: [pmId, ...(clientId ? [clientId] : [])], // PM and client can approve/reject elements
          canAccessMessages: [pmId, vendorId, ...(clientId ? [clientId] : [])], // All have full message access
          canAccessVideoCall: [pmId, vendorId, ...(clientId ? [clientId] : [])] // All have full video call access
        }
      },

      // Default workspace structure
      nodes: [],
      layers: [
        {
          id: 'default',
          name: 'Main Layer',
          visible: true,
          locked: false
        }
      ],
      
      // Project metadata
      projectMetadata: {
        pmId,
        projectName: project?.name,
        clientId,
        leadId,
        createdBy: 'pm_approval_system'
      },

      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save using the model
    const createdWorkspace = await DynamoWorkspace.createWorkspace(workspaceData);

    console.log('✅ New collaborative workspace created:', workspaceId);
    return createdWorkspace;
  } catch (error) {
    console.error('Error creating new collaborative workspace:', error);
    throw error;
  }
}
