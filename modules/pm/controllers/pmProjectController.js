import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { dynamoDB, WORKSPACES_TABLE } from '../../../config/aws.js';

const PM_PROJECTS_TABLE = 'pm_projects_table';

// Get all projects for a PM
export const getPMProjects = async (req, res) => {
  try {
    const { pmId } = req.pmUser; // From JWT token
    const { status, limit = 50, lastKey } = req.query;

    console.log('📋 Getting projects for PM:', pmId);

    let params = {
      TableName: PM_PROJECTS_TABLE,
      IndexName: 'PMIdIndex',
      KeyConditionExpression: 'pmId = :pmId',
      ExpressionAttributeValues: {
        ':pmId': pmId
      },
      ScanIndexForward: false, // Latest first
      Limit: parseInt(limit)
    };

    // Add status filter if provided
    if (status) {
      params.FilterExpression = '#status = :status';
      params.ExpressionAttributeNames = { '#status': 'status' };
      params.ExpressionAttributeValues[':status'] = status;
    }

    // Add pagination if lastKey provided
    if (lastKey) {
      params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
    }

    const result = await dynamoDB.query(params).promise();

    // Transform projects for frontend
    const projects = result.Items.map(project => ({
      id: project.projectId,
      name: project.name,
      description: project.description,
      status: project.status,
      budget: project.budget,
      timeline: project.timeline,
      priority: project.priority,
      location: project.location,
      category: project.category,
      phases: project.phases || [],
      vendorRequirements: project.vendorRequirements || [],
      invitedVendors: project.invitedVendors || [],
      approvedVendors: project.approvedVendors || [],
      workspaceId: project.workspaceId,
      workspaceCreated: project.workspaceCreated || false,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      tags: project.tags || []
    }));

    console.log(`✅ Found ${projects.length} projects for PM ${pmId}`);

    res.json({
      success: true,
      projects,
      pagination: {
        hasMore: !!result.LastEvaluatedKey,
        lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null,
        count: projects.length
      }
    });

  } catch (error) {
    console.error('❌ Error getting PM projects:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get projects'
    });
  }
};

// Get single project by ID
export const getPMProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { pmId } = req.pmUser;

    console.log('📄 Getting project:', projectId, 'for PM:', pmId);

    const result = await dynamoDB.get({
      TableName: PM_PROJECTS_TABLE,
      Key: { projectId }
    }).promise();

    if (!result.Item) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    const project = result.Item;

    // Check if PM owns this project
    if (project.pmId !== pmId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this project'
      });
    }

    // Transform for frontend
    const projectData = {
      id: project.projectId,
      name: project.name,
      description: project.description,
      status: project.status,
      budget: project.budget,
      timeline: project.timeline,
      priority: project.priority,
      location: project.location,
      category: project.category,
      phases: project.phases || [],
      vendorRequirements: project.vendorRequirements || [],
      invitedVendors: project.invitedVendors || [],
      approvedVendors: project.approvedVendors || [],
      workspaceId: project.workspaceId,
      workspaceCreated: project.workspaceCreated || false,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      tags: project.tags || []
    };

    console.log('✅ Project found:', project.name);

    res.json({
      success: true,
      project: projectData
    });

  } catch (error) {
    console.error('❌ Error getting project:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get project'
    });
  }
};

// Create new project
export const createPMProject = async (req, res) => {
  try {
    const { pmId } = req.pmUser;
    const {
      name,
      description,
      budget,
      timeline,
      priority = 'medium',
      location,
      category,
      phases = [],
      vendorRequirements = [],
      tags = []
    } = req.body;

    // Validation
    if (!name || !description) {
      return res.status(400).json({
        success: false,
        error: 'Project name and description are required'
      });
    }

    console.log('🆕 Creating new project:', name, 'for PM:', pmId);

    const projectId = `PROJ-${Date.now()}`;
    const now = new Date().toISOString();

    const newProject = {
      projectId,
      pmId,
      name,
      description,
      status: 'draft',
      budget: budget || 'TBD',
      timeline: timeline || 'TBD',
      priority,
      location: location || '',
      category: category || 'General',
      
      // Default phases if none provided
      phases: phases.length > 0 ? phases : [
        { id: 1, name: 'Planning', status: 'pending', startDate: null, endDate: null },
        { id: 2, name: 'Execution', status: 'pending', startDate: null, endDate: null },
        { id: 3, name: 'Review', status: 'pending', startDate: null, endDate: null }
      ],
      
      vendorRequirements,
      invitedVendors: [],
      approvedVendors: [],
      
      // Workspace info
      workspaceId: null,
      workspaceCreated: false,
      
      // Metadata
      createdAt: now,
      updatedAt: now,
      createdBy: pmId,
      tags
    };

    await dynamoDB.put({
      TableName: PM_PROJECTS_TABLE,
      Item: newProject,
      ConditionExpression: 'attribute_not_exists(projectId)'
    }).promise();

    // Update PM's project count
    await updatePMProjectCount(pmId, 1);

    console.log('✅ Project created successfully:', projectId);

    // Return transformed project
    const projectData = {
      id: newProject.projectId,
      name: newProject.name,
      description: newProject.description,
      status: newProject.status,
      budget: newProject.budget,
      timeline: newProject.timeline,
      priority: newProject.priority,
      location: newProject.location,
      category: newProject.category,
      phases: newProject.phases,
      vendorRequirements: newProject.vendorRequirements,
      invitedVendors: newProject.invitedVendors,
      approvedVendors: newProject.approvedVendors,
      workspaceId: newProject.workspaceId,
      workspaceCreated: newProject.workspaceCreated,
      createdAt: newProject.createdAt,
      updatedAt: newProject.updatedAt,
      tags: newProject.tags
    };

    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      project: projectData
    });

  } catch (error) {
    console.error('❌ Error creating project:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create project'
    });
  }
};

// Update project
export const updatePMProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { pmId } = req.pmUser;
    const updates = req.body;

    console.log('📝 Updating project:', projectId, 'for PM:', pmId);

    // First check if project exists and belongs to PM
    const existingProject = await dynamoDB.get({
      TableName: PM_PROJECTS_TABLE,
      Key: { projectId }
    }).promise();

    if (!existingProject.Item) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    if (existingProject.Item.pmId !== pmId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this project'
      });
    }

    // Build update expression
    const updateExpression = [];
    const expressionAttributeValues = {};
    const expressionAttributeNames = {};

    // Allowed fields to update
    const allowedFields = [
      'name', 'description', 'budget', 'timeline', 'priority', 
      'location', 'category', 'status', 'phases', 'vendorRequirements', 
      'invitedVendors', 'approvedVendors', 'workspaceId', 'workspaceCreated', 'tags'
    ];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value !== undefined) {
        updateExpression.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = value;
      }
    }

    if (updateExpression.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    // Always update the updatedAt timestamp
    updateExpression.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date().toISOString();

    const params = {
      TableName: PM_PROJECTS_TABLE,
      Key: { projectId },
      UpdateExpression: `SET ${updateExpression.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();
    const updatedProject = result.Attributes;

    console.log('✅ Project updated successfully:', projectId);

    // Transform for frontend
    const projectData = {
      id: updatedProject.projectId,
      name: updatedProject.name,
      description: updatedProject.description,
      status: updatedProject.status,
      budget: updatedProject.budget,
      timeline: updatedProject.timeline,
      priority: updatedProject.priority,
      location: updatedProject.location,
      category: updatedProject.category,
      phases: updatedProject.phases || [],
      vendorRequirements: updatedProject.vendorRequirements || [],
      invitedVendors: updatedProject.invitedVendors || [],
      approvedVendors: updatedProject.approvedVendors || [],
      workspaceId: updatedProject.workspaceId,
      workspaceCreated: updatedProject.workspaceCreated || false,
      createdAt: updatedProject.createdAt,
      updatedAt: updatedProject.updatedAt,
      tags: updatedProject.tags || []
    };

    res.json({
      success: true,
      message: 'Project updated successfully',
      project: projectData
    });

  } catch (error) {
    console.error('❌ Error updating project:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update project'
    });
  }
};

// Delete project
export const deletePMProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { pmId } = req.pmUser;

    console.log('🗑️ Deleting project:', projectId, 'for PM:', pmId);

    // First check if project exists and belongs to PM
    const existingProject = await dynamoDB.get({
      TableName: PM_PROJECTS_TABLE,
      Key: { projectId }
    }).promise();

    if (!existingProject.Item) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    if (existingProject.Item.pmId !== pmId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this project'
      });
    }

    // Delete the project
    await dynamoDB.delete({
      TableName: PM_PROJECTS_TABLE,
      Key: { projectId }
    }).promise();

    // Update PM's project count
    await updatePMProjectCount(pmId, -1);

    console.log('✅ Project deleted successfully:', projectId);

    res.json({
      success: true,
      message: 'Project deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting project:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete project'
    });
  }
};

// Get project statistics for PM
export const getPMProjectStats = async (req, res) => {
  try {
    const { pmId } = req.pmUser;

    console.log('📊 Getting project stats for PM:', pmId);

    // Get all projects for this PM
    const result = await dynamoDB.query({
      TableName: PM_PROJECTS_TABLE,
      IndexName: 'PMIdIndex',
      KeyConditionExpression: 'pmId = :pmId',
      ExpressionAttributeValues: {
        ':pmId': pmId
      }
    }).promise();

    const projects = result.Items;

    // Calculate statistics
    const stats = {
      totalProjects: projects.length,
      projectsByStatus: {
        draft: projects.filter(p => p.status === 'draft').length,
        planning: projects.filter(p => p.status === 'planning').length,
        active: projects.filter(p => p.status === 'active').length,
        completed: projects.filter(p => p.status === 'completed').length,
        on_hold: projects.filter(p => p.status === 'on_hold').length
      },
      projectsByPriority: {
        high: projects.filter(p => p.priority === 'high').length,
        medium: projects.filter(p => p.priority === 'medium').length,
        low: projects.filter(p => p.priority === 'low').length
      },
      totalBudget: projects.reduce((sum, p) => {
        const budget = p.budget?.replace(/[$,M]/g, '') || '0';
        return sum + (parseFloat(budget) || 0);
      }, 0),
      totalVendorsInvited: projects.reduce((sum, p) => sum + (p.invitedVendors?.length || 0), 0),
      totalVendorsApproved: projects.reduce((sum, p) => sum + (p.approvedVendors?.length || 0), 0),
      workspacesCreated: projects.filter(p => p.workspaceCreated).length
    };

    console.log('✅ Project stats calculated for PM:', pmId);

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('❌ Error getting project stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get project statistics'
    });
  }
};

// Add this function to handle CAS member invitations
export const inviteCASMembersToWorkspace = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { employeeIds, employees } = req.body;

    console.log('👥 Inviting CAS members to workspace:', {
      workspaceId,
      employeeIds,
      employeeCount: employees?.length
    });

    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Employee IDs are required'
      });
    }

    if (!employees || !Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Employee details are required'
      });
    }

    // Get the workspace/project details
    // workspaces_table uses "workspaceId" as the HASH key (see createWorkspacesTable.js)
    // so we must query by workspaceId, not the legacy "id" field.
    const getParams = {
      TableName: WORKSPACES_TABLE,
      Key: {
        workspaceId: workspaceId
      }
    };

    const workspaceResult = await dynamoDB.get(getParams).promise();
    
    if (!workspaceResult.Item) {
      return res.status(404).json({
        success: false,
        message: 'Workspace not found'
      });
    }

    const workspace = workspaceResult.Item;

    // Add CAS members to the workspace collaborators
    const existingCollaborators = workspace.casCollaborators || [];
    const existingCollaboratorIds = existingCollaborators.map(c => c.userId);
    
    // Filter out employees that are already collaborators
    const newCollaborators = employees.filter(emp => 
      !existingCollaboratorIds.includes(emp.userId)
    ).map(emp => ({
      userId: emp.userId,
      name: emp.name,
      email: emp.email,
      casUnit: emp.casUnit,
      role: emp.role,
      accessLevel: 'CAS Unit',
      status: 'active',
      invitedAt: new Date().toISOString(),
      lastActivity: {
        timestamp: new Date().toISOString(),
        action: 'invited'
      }
    }));

    if (newCollaborators.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'All selected employees are already collaborators'
      });
    }

    const updatedCollaborators = [...existingCollaborators, ...newCollaborators];

    // Update the workspace with new CAS collaborators
    // Again, use "workspaceId" as the primary key to match the table schema.
    const updateParams = {
      TableName: WORKSPACES_TABLE,
      Key: {
        workspaceId: workspaceId
      },
      UpdateExpression: 'SET casCollaborators = :collaborators, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':collaborators': updatedCollaborators,
        ':updatedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    const updateResult = await dynamoDB.update(updateParams).promise();

    // Send notifications to invited CAS members
    const notificationPromises = newCollaborators.map(async (collaborator) => {
      try {
        // Send notification to employee system (Trunky notifications)
        const notificationResponse = await fetch('http://localhost:5003/api/trunky/notifications', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: collaborator.userId,
            message: `You have been invited to collaborate on project: ${workspace.title || workspace.name}`,
            type: 'project_invitation',
            link: `/workspace/${workspaceId}`,
            projectId: workspaceId,
            projectName: workspace.title || workspace.name,
            senderName: 'Project Manager'
          })
        });

        if (!notificationResponse.ok) {
          console.warn(`Failed to send notification to ${collaborator.userId}`);
        }

        console.log(`✅ Notification sent to ${collaborator.name} (${collaborator.userId})`);
      } catch (error) {
        console.error(`Failed to notify ${collaborator.userId}:`, error.message);
      }
    });

    // Wait for all notifications to be sent (but don't fail if some fail)
    await Promise.allSettled(notificationPromises);

    console.log('✅ Successfully invited CAS members to workspace');

    res.status(200).json({
      success: true,
      message: `Successfully invited ${newCollaborators.length} CAS member${newCollaborators.length > 1 ? 's' : ''}`,
      invitedMembers: newCollaborators,
      workspace: updateResult.Attributes
    });

  } catch (error) {
    console.error('❌ Error inviting CAS members to workspace:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to invite CAS members',
      error: error.message
    });
  }
};

// Helper function to update PM's project count
const updatePMProjectCount = async (pmId, increment) => {
  try {
    await dynamoDB.update({
      TableName: 'pm_users_table',
      Key: { pmId },
      UpdateExpression: 'ADD projectsCount :increment',
      ExpressionAttributeValues: {
        ':increment': increment
      }
    }).promise();
  } catch (error) {
    console.error('❌ Error updating PM project count:', error);
    // Don't throw error, just log it
  }
};
