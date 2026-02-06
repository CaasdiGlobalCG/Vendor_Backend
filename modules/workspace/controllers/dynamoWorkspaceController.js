import * as DynamoWorkspace from '../models/DynamoWorkspace.js';
import ActivityTracker from '../../../utils/activityTracker.js';
import { dynamoDB } from '../../../config/aws.js';

// Create a new workspace
export const createWorkspace = async (req, res) => {
  try {
    const workspaceData = req.body;
    const workspace = await DynamoWorkspace.createWorkspace(workspaceData);
    
    res.status(201).json(workspace);
  } catch (error) {
    console.error('Error creating workspace:', error);
    res.status(500).json({ message: 'Failed to create workspace', error: error.message });
  }
};

// Get workspace by ID
export const getWorkspaceById = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get workspace from workspaces_table
    const workspace = await DynamoWorkspace.getWorkspaceById(id);
    
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    
    res.status(200).json(workspace);
  } catch (error) {
    console.error('Error getting workspace by ID:', error);
    res.status(500).json({ message: 'Failed to get workspace', error: error.message });
  }
};

// Get workspace by lead ID
export const getWorkspaceByLeadId = async (req, res) => {
  try {
    const { leadId } = req.params;
    const workspace = await DynamoWorkspace.getWorkspaceByLeadId(leadId);
    
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found for this lead' });
    }
    
    res.status(200).json(workspace);
  } catch (error) {
    console.error('Error getting workspace by lead ID:', error);
    res.status(500).json({ message: 'Failed to get workspace', error: error.message });
  }
};

// Get workspace by project ID
export const getWorkspaceByProjectId = async (req, res) => {
  try {
    const { projectId } = req.params;
    const workspace = await DynamoWorkspace.getWorkspaceByProjectId(projectId);
    
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found for this project' });
    }
    // Normalize status fields for UI compatibility
    const statusRaw = (typeof workspace.status === 'string' ? workspace.status : '').toLowerCase();
    const projectStatusRaw = (typeof workspace.project_status === 'string' ? workspace.project_status : '').toLowerCase();
    let normalizedStatus = workspace.status || 'Pending';
    if (statusRaw === 'project completed' || statusRaw === 'completed' || projectStatusRaw === 'project completed' || projectStatusRaw === 'completed') {
      normalizedStatus = 'Completed';
    } else if (statusRaw === 'in progress' || statusRaw === 'active' || statusRaw === 'inprogress' || projectStatusRaw === 'in progress' || projectStatusRaw === 'active' || projectStatusRaw === 'inprogress') {
      normalizedStatus = 'InProgress';
    }
    // Return workspace with normalized status field
    const responseWorkspace = { ...workspace, status: normalizedStatus };
    res.status(200).json(responseWorkspace);
  } catch (error) {
    console.error('Error getting workspace by project ID:', error);
    res.status(500).json({ message: 'Failed to get workspace', error: error.message });
  }
};

// Get workspaces by vendor ID
export const getWorkspacesByVendorId = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const workspaces = await DynamoWorkspace.getWorkspacesByVendorId(vendorId);
    res.status(200).json(workspaces);
  } catch (error) {
    console.error('Error getting workspaces by vendor ID:', error);
    res.status(500).json({ message: 'Failed to get workspaces', error: error.message });
  }
};

// Create or get workspace for a lead/project
export const createOrGetWorkspaceForLead = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { vendorId, projectId } = req.body;
    
    if (!vendorId) {
      return res.status(400).json({ message: 'Vendor ID is required' });
    }
    
    const workspace = await DynamoWorkspace.createOrGetWorkspaceForLead(leadId, vendorId, projectId);
    res.status(200).json(workspace);
  } catch (error) {
    console.error('Error creating or getting workspace for lead:', error);
    res.status(500).json({ message: 'Failed to create or get workspace', error: error.message });
  }
};

// Update a workspace
export const updateWorkspace = async (req, res) => {
  try {
    const { id } = req.params;
    const workspaceData = req.body;
    // Fetch existing workspace to enforce locks (e.g., project completed)
    const existingWorkspace = await DynamoWorkspace.getWorkspaceById(id);
    if (!existingWorkspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }

    // If workspace is completed, prevent vendors from making changes
    const requesterRole = req.user?.role || '';
    const isVendorRequester = requesterRole && requesterRole.toLowerCase() !== 'pm' && requesterRole.toLowerCase() !== 'admin';
    if (existingWorkspace.status === 'project completed' && isVendorRequester) {
      return res.status(403).json({ message: 'Workspace is locked as project completed; edits are not allowed' });
    }

    const updatedWorkspace = await DynamoWorkspace.updateWorkspace(id, workspaceData);
    
    if (!updatedWorkspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    
    res.status(200).json(updatedWorkspace);
  } catch (error) {
    console.error('Error updating workspace:', error);
    res.status(500).json({ message: 'Failed to update workspace', error: error.message });
  }
};

// Save workspace canvas data (specialized update for canvas state)
export const saveWorkspaceCanvas = async (req, res) => {
  try {
    const { id } = req.params;
    const { nodes, edges, layers, zoomLevel, canvasSettings } = req.body;
    
    console.log('🔄 Backend: saveWorkspaceCanvas called', {
      workspaceId: id,
      requestBody: {
        nodesCount: nodes?.length || 0,
        edgesCount: edges?.length || 0,
        layersCount: layers?.length || 0,
        zoomLevel,
        hasCanvasSettings: !!canvasSettings
      }
    });
    
    // Fetch existing workspace to ensure it's not locked
    const existingWorkspace = await DynamoWorkspace.getWorkspaceById(id);
    if (!existingWorkspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }

    // Prevent vendors from modifying canvas on completed projects
    const requesterRole = req.user?.role || '';
    const isVendorRequester = requesterRole && requesterRole.toLowerCase() !== 'pm' && requesterRole.toLowerCase() !== 'admin';
    if (existingWorkspace.status === 'project completed' && isVendorRequester) {
      return res.status(403).json({ message: 'Workspace is locked as project completed; canvas updates are not allowed' });
    }

    const workspaceData = {
      nodes: nodes || [],
      edges: edges || [],
      layers: layers || [],
      zoomLevel: zoomLevel || 100,
      canvasSettings: canvasSettings || {}
    };
    
    console.log('💾 Backend: Prepared workspace data for save:', {
      nodesCount: workspaceData.nodes.length,
      edgesCount: workspaceData.edges.length,
      layersCount: workspaceData.layers.length,
      zoomLevel: workspaceData.zoomLevel
    });
    
    // Update workspace in workspaces_table
    const updatedWorkspace = await DynamoWorkspace.updateWorkspace(id, workspaceData);
    
    if (!updatedWorkspace) {
      console.error('❌ Backend: Workspace not found for ID:', id);
      return res.status(404).json({ message: 'Workspace not found' });
    }
    
    console.log('✅ Backend: Workspace canvas saved successfully', {
      workspaceId: id,
      updatedAt: updatedWorkspace.updatedAt
    });
    
    res.status(200).json({ 
      message: 'Workspace canvas saved successfully',
      workspace: updatedWorkspace 
    });
  } catch (error) {
    console.error('❌ Backend: Error saving workspace canvas:', error);
    res.status(500).json({ message: 'Failed to save workspace canvas', error: error.message });
  }
};

// Delete a workspace
export const deleteWorkspace = async (req, res) => {
  try {
    const { id } = req.params;
    await DynamoWorkspace.deleteWorkspace(id);
    res.status(200).json({ message: 'Workspace deleted successfully' });
  } catch (error) {
    console.error('Error deleting workspace:', error);
    res.status(500).json({ message: 'Failed to delete workspace', error: error.message });
  }
};

// Share workspace with other users
export const shareWorkspace = async (req, res) => {
  try {
    const { id } = req.params;
    const { sharedWith, isShared } = req.body;
    
    const workspaceData = {
      isShared: isShared !== undefined ? isShared : true,
      sharedWith: sharedWith || []
    };
    
    const updatedWorkspace = await DynamoWorkspace.updateWorkspace(id, workspaceData);
    
    if (!updatedWorkspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    
    res.status(200).json({ 
      message: 'Workspace sharing updated successfully',
      workspace: updatedWorkspace 
    });
  } catch (error) {
    console.error('Error updating workspace sharing:', error);
    res.status(500).json({ message: 'Failed to update workspace sharing', error: error.message });
  }
};

// Add task to workspace
export const addTaskToWorkspace = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, priority, dueDate, userId, userEmail, userName } = req.body;
    
    console.log('🔄 Backend: Adding task to workspace', { workspaceId: id, taskName: name });
    
    // Get current workspace
    const workspace = await DynamoWorkspace.getWorkspaceById(id);
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
      // Prevent adding tasks if workspace is completed and requester is vendor
      const requesterRole = req.user?.role || '';
      const isVendorRequester = requesterRole && requesterRole.toLowerCase() !== 'pm' && requesterRole.toLowerCase() !== 'admin';
      if (workspace.status === 'project completed' && isVendorRequester) {
        return res.status(403).json({ message: 'Workspace is locked as project completed; cannot add tasks' });
      }
    
    // Create new task
    const newTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: name || 'Untitled Task',
      description: description || '',
      priority: priority || 'medium',
      status: 'active',
      dueDate: dueDate || null,
      assignedUsers: 1, // Default assigned users for display
      color: 'bg-blue-500', // Default color for backward compatibility
      subtasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // Add task to workspace
    const currentTasks = workspace.tasks || [];
    const updatedTasks = [...currentTasks, newTask];
    
    const updatedWorkspace = await DynamoWorkspace.updateWorkspace(id, { tasks: updatedTasks });
    
    // Track activity
    if (userId && userEmail && userName) {
      await ActivityTracker.trackTaskActivity(
        id,
        newTask.id,
        userId,
        userEmail,
        userName,
        'task_created',
        {
          taskName: newTask.name,
          taskDescription: newTask.description,
          priority: newTask.priority
        }
      );
    }
    
    console.log('✅ Backend: Task added successfully', { taskId: newTask.id });
    
    res.status(201).json({
      message: 'Task added successfully',
      task: newTask,
      workspace: updatedWorkspace
    });
  } catch (error) {
    console.error('❌ Backend: Error adding task:', error);
    res.status(500).json({ message: 'Failed to add task', error: error.message });
  }
};

// Add subtask to task
export const addSubtaskToTask = async (req, res) => {
  try {
    const { id, taskId } = req.params;
    const { name, description, userId, userEmail, userName } = req.body;
    
    console.log('🔄 Backend: Adding subtask to task', { workspaceId: id, taskId, subtaskName: name });
    
    // Get current workspace
    const workspace = await DynamoWorkspace.getWorkspaceById(id);
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    // Prevent adding subtasks if workspace is completed and requester is vendor
    const requesterRole2 = req.user?.role || '';
    const isVendorRequester2 = requesterRole2 && requesterRole2.toLowerCase() !== 'pm' && requesterRole2.toLowerCase() !== 'admin';
    if (workspace.status === 'project completed' && isVendorRequester2) {
      return res.status(403).json({ message: 'Workspace is locked as project completed; cannot add subtasks' });
    }
    
    // Find the task
    const tasks = workspace.tasks || [];
    const taskIndex = tasks.findIndex(task => task.id === taskId);
    if (taskIndex === -1) {
      return res.status(404).json({ message: 'Task not found' });
    }
    
    // Create new subtask
    const newSubtask = {
      id: `subtask_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: name || 'Untitled Subtask',
      description: description || '',
      status: 'active',
      assignedUsers: 1, // Default assigned users for display
      color: 'bg-gray-400', // Default color for backward compatibility
      canvasData: {
        nodes: [],
        edges: [],
        zoomLevel: 100
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // Add subtask to task
    const updatedTasks = [...tasks];
    updatedTasks[taskIndex].subtasks = [...(updatedTasks[taskIndex].subtasks || []), newSubtask];
    updatedTasks[taskIndex].updatedAt = new Date().toISOString();
    
    const updatedWorkspace = await DynamoWorkspace.updateWorkspace(id, { tasks: updatedTasks });
    
    // Track activity
    if (userId && userEmail && userName) {
      await ActivityTracker.trackSubtaskActivity(
        id,
        taskId,
        newSubtask.id,
        userId,
        userEmail,
        userName,
        'subtask_created',
        {
          subtaskName: newSubtask.name,
          subtaskDescription: newSubtask.description,
          taskName: updatedTasks[taskIndex].name
        }
      );
    }
    
    console.log('✅ Backend: Subtask added successfully', { subtaskId: newSubtask.id });
    
    res.status(201).json({
      message: 'Subtask added successfully',
      subtask: newSubtask,
      task: updatedTasks[taskIndex],
      workspace: updatedWorkspace
    });
  } catch (error) {
    console.error('❌ Backend: Error adding subtask:', error);
    res.status(500).json({ message: 'Failed to add subtask', error: error.message });
  }
};

// Update subtask canvas data
export const updateSubtaskCanvas = async (req, res) => {
  try {
    const { id, taskId, subtaskId } = req.params;
    const { nodes, edges, zoomLevel } = req.body;
    
    console.log('🔄 Backend: Updating subtask canvas', { 
      workspaceId: id, 
      taskId, 
      subtaskId,
      nodesCount: nodes?.length || 0,
      edgesCount: edges?.length || 0
    });
    
    // Get current workspace
    const workspace = await DynamoWorkspace.getWorkspaceById(id);
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    
    // Find the task and subtask
    const tasks = workspace.tasks || [];
    const taskIndex = tasks.findIndex(task => task.id === taskId);
    if (taskIndex === -1) {
      return res.status(404).json({ message: 'Task not found' });
    }
    
    const subtasks = tasks[taskIndex].subtasks || [];
    const subtaskIndex = subtasks.findIndex(subtask => subtask.id === subtaskId);
    if (subtaskIndex === -1) {
      return res.status(404).json({ message: 'Subtask not found' });
    }

    const approvalRank = (status) => {
      const normalized = (typeof status === 'string' ? status : '').toLowerCase();
      const order = {
        '': 0,
        'draft': 1,
        'pending': 2,
        'sent_to_pm': 3,
        'pm_approved': 4,
        'client_approved': 5,
        'locked': 6,
        'approved': 6,
        'rejected': 6
      };
      return order[normalized] ?? 0;
    };

    const mergeNodeData = (existingNode, incomingNode) => {
      if (!existingNode) return incomingNode;

      const existingData = existingNode.data || {};
      const incomingData = incomingNode.data || {};

      const existingStatus = existingData.approvalStatus;
      const incomingStatus = incomingData.approvalStatus;

      // Basic merge: keep incoming changes, but preserve any existing fields not provided
      const merged = {
        ...existingNode,
        ...incomingNode,
        data: {
          ...existingData,
          ...incomingData
        }
      };

      // Never allow approval status to move backwards due to stale autosaves
      if (approvalRank(existingStatus) > approvalRank(incomingStatus)) {
        merged.data.approvalStatus = existingStatus;
      }

      // Preserve nested approval objects if incoming payload omitted them
      if (existingData.pmApproval && !incomingData.pmApproval) {
        merged.data.pmApproval = existingData.pmApproval;
      }
      if (existingData.clientApproval && !incomingData.clientApproval) {
        merged.data.clientApproval = existingData.clientApproval;
      }

      return merged;
    };
    
    // Update subtask canvas data
    const updatedTasks = [...tasks];

    const existingCanvasData = updatedTasks[taskIndex].subtasks[subtaskIndex].canvasData || { nodes: [], edges: [], zoomLevel: 100 };
    const existingNodes = existingCanvasData.nodes || [];
    const existingNodesById = new Map(existingNodes.filter(n => n && n.id).map(n => [n.id, n]));

    const incomingNodes = Array.isArray(nodes) ? nodes : [];
    const mergedNodes = incomingNodes.map((n) => mergeNodeData(existingNodesById.get(n?.id), n));

    updatedTasks[taskIndex].subtasks[subtaskIndex].canvasData = {
      nodes: mergedNodes,
      edges: Array.isArray(edges) ? edges : (existingCanvasData.edges || []),
      zoomLevel: zoomLevel || existingCanvasData.zoomLevel || 100
    };
    updatedTasks[taskIndex].subtasks[subtaskIndex].updatedAt = new Date().toISOString();
    updatedTasks[taskIndex].updatedAt = new Date().toISOString();
    
    // Only update the tasks array, NOT the workspace's main nodes/edges
    // Each subtask should have its own independent canvasData
    // DO NOT copy subtask nodes to workspace nodes as this causes elements from one subtask to appear in others
    const workspaceUpdateData = {
      tasks: updatedTasks
    };
    
    const updatedWorkspace = await DynamoWorkspace.updateWorkspace(id, workspaceUpdateData);
    
    console.log('✅ Backend: Subtask canvas updated successfully', {
      nodesCount: nodes?.length || 0,
      edgesCount: edges?.length || 0,
      subtaskId,
      taskId
    });
    
    // Verify the nodes were actually saved to DynamoDB by reading back
    try {
      const { WORKSPACES_TABLE } = await import('../../../config/aws.js');
      // Wait a moment for eventual consistency
      await new Promise(resolve => setTimeout(resolve, 100));
      const verifyParams = {
        TableName: WORKSPACES_TABLE,
        Key: { workspaceId: id }
      };
      const verifyResult = await dynamoDB.get(verifyParams).promise();
      if (verifyResult.Item) {
        const itemTasks = Array.isArray(verifyResult.Item.tasks) ? verifyResult.Item.tasks : [];
        const savedTask = itemTasks.find(t => t?.id === taskId);
        const savedSubtask = (savedTask?.subtasks || []).find(st => st?.id === subtaskId);

        if (!savedTask) {
          console.warn('⚠️ Backend: Verification could not find taskId in saved item:', {
            taskId,
            availableTaskIds: itemTasks.map(t => t?.id).filter(Boolean)
          });
        }
        if (savedTask && !savedSubtask) {
          console.warn('⚠️ Backend: Verification could not find subtaskId in saved task:', {
            taskId,
            subtaskId,
            availableSubtaskIds: (savedTask?.subtasks || []).map(st => st?.id).filter(Boolean)
          });
        }
        const savedCanvasNodes = savedSubtask?.canvasData?.nodes || [];
        const savedCanvasEdges = savedSubtask?.canvasData?.edges || [];

        console.log('🔍 Backend: Verification (subtask canvas) - nodes count in DynamoDB:', savedCanvasNodes.length);
        console.log('🔍 Backend: Verification (subtask canvas) - edges count in DynamoDB:', savedCanvasEdges.length);

        const nodesWithApproval = savedCanvasNodes.filter(n => n?.data?.approvalStatus);
        console.log('🔍 Backend: Verification (subtask canvas) - nodes with approval status:', nodesWithApproval.length);
        nodesWithApproval.forEach((node, idx) => {
          console.log(`  Verified Node ${idx}:`, {
            id: node.id,
            approvalStatus: node.data?.approvalStatus,
            hasPmApproval: !!node.data?.pmApproval,
            hasClientApproval: !!node.data?.clientApproval
          });
        });

        if (savedCanvasNodes.length !== (nodes?.length || 0)) {
          console.error('❌ Backend: VERIFICATION MISMATCH (subtask canvas)!');
          console.error('❌ Backend: Expected nodes count:', nodes?.length || 0);
          console.error('❌ Backend: Actual nodes count in DB (subtask canvas):', savedCanvasNodes.length);
        } else {
          console.log('✅ Backend: Verification passed (subtask canvas) - nodes match!');
        }
      } else {
        console.error('❌ Backend: Verification failed - workspace not found in DynamoDB!');
      }
    } catch (verifyErr) {
      console.error('❌ Backend: Error during verification:', verifyErr.message);
    }
    
    res.status(200).json({
      message: 'Subtask canvas updated successfully',
      subtask: updatedTasks[taskIndex].subtasks[subtaskIndex],
      workspace: updatedWorkspace
    });
  } catch (error) {
    console.error('❌ Backend: Error updating subtask canvas:', error);
    res.status(500).json({ message: 'Failed to update subtask canvas', error: error.message });
  }
};

// Get workspace collaborators with vendor details and activity
export const getWorkspaceCollaborators = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    console.log('🔍 Fetching collaborators for workspace:', workspaceId);

    // Get workspace data
    const workspace = await DynamoWorkspace.getWorkspaceById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }

    const collaborators = [];
    const clientId = workspace.projectMetadata?.clientId;
    
    if (workspace.sharedWith && workspace.sharedWith.length > 0) {
      for (const userId of workspace.sharedWith) {
        try {
          // Check if this is the client
          if (clientId && userId === clientId) {
            console.log('👥 Found client in sharedWith:', clientId);
            
            // Fetch client details from clients table
            let clientName = 'Client';
            let clientEmail = 'client@company.com';
            let clientCompany = 'Client Organization';
            
            try {
              const clientResult = await dynamoDB.get({
                TableName: 'clients',
                Key: { clientId }
              }).promise();

              if (clientResult.Item) {
                const client = clientResult.Item;
                clientName = client.contactName || client.companyName || 'Client';
                clientEmail = client.email || 'client@company.com';
                clientCompany = client.companyName || 'Client Organization';
                console.log('✅ Fetched client details:', { clientName, clientEmail, clientCompany });
              }
            } catch (clientError) {
              console.warn('⚠️ Could not fetch client details from clients table:', clientError.message);
              // Use defaults already set above
            }
            
            collaborators.push({
              vendorId: clientId,
              name: clientName,
              email: clientEmail,
              specialization: clientCompany,
              accessLevel: workspace.accessControl?.permissions?.canEdit?.includes(clientId) ? 'Edit' : 'View',
              status: 'active',
              lastActivity: { 
                action: 'Added to workspace', 
                timestamp: workspace.createdAt,
                description: 'Client added to collaborative workspace'
              },
              joinedAt: workspace.createdAt,
              avatar: (clientName?.charAt(0) || 'C').toUpperCase(),
              isClient: true
            });
          } else {
            // Try to fetch vendor details
            const vendorResult = await dynamoDB.get({
              TableName: 'vendors',
              Key: { vendorId: userId }
            }).promise();

            if (vendorResult.Item) {
              const vendor = vendorResult.Item;
              
              // Get vendor's last activity (simplified - you can enhance this)
              const lastActivity = await getVendorLastActivity(userId, workspaceId);
              
              collaborators.push({
                vendorId: vendor.vendorId,
                name: vendor.name || vendor.vendorDetails?.companyName || vendor.vendorDetails?.primaryContactName || 'Unknown Vendor',
                email: vendor.email || vendor.vendorDetails?.primaryContactEmail || 'N/A',
                specialization: vendor.specialization || vendor.category || vendor.companyDetails?.industryType || 'General',
                accessLevel: workspace.accessControl?.permissions?.canEdit?.includes(userId) ? 'Edit' : 'View',
                status: vendor.status === 'approved' ? 'active' : 'inactive',
                lastActivity: lastActivity,
                joinedAt: workspace.createdAt, // Simplified
                avatar: (vendor.name?.charAt(0) || vendor.vendorDetails?.companyName?.charAt(0) || vendor.vendorDetails?.primaryContactName?.charAt(0) || 'V').toUpperCase()
              });
            } else {
              // Not found in vendors table - might be a client or other user type
              console.log('⚠️ User not found in vendors table:', userId);
              collaborators.push({
                vendorId: userId,
                name: 'Unknown User',
                email: 'N/A',
                specialization: 'Unknown',
                accessLevel: workspace.accessControl?.permissions?.canEdit?.includes(userId) ? 'Edit' : 'View',
                status: 'inactive',
                lastActivity: { action: 'N/A', timestamp: null },
                joinedAt: workspace.createdAt,
                avatar: 'U'
              });
            }
          }
        } catch (error) {
          console.error(`Error processing collaborator ${userId}:`, error.message);
          // Add placeholder
          collaborators.push({
            vendorId: userId,
            name: 'Unknown User',
            email: 'N/A',
            specialization: 'Unknown',
            accessLevel: 'View',
            status: 'inactive',
            lastActivity: { action: 'N/A', timestamp: null },
            joinedAt: workspace.createdAt,
            avatar: 'U'
          });
        }
      }
    }

    // Add PM details if available
    if (workspace.accessControl?.owner) {
      const pmId = workspace.accessControl.owner;
      collaborators.unshift({
        vendorId: pmId,
        name: workspace.projectMetadata?.pmName || 'Project Manager',
        email: 'pm@construction.com', // You can fetch from PM table
        specialization: 'Project Management',
        accessLevel: 'Owner',
        status: 'active',
        lastActivity: { 
          action: 'Workspace created', 
          timestamp: workspace.createdAt,
          description: 'Created collaborative workspace'
        },
        joinedAt: workspace.createdAt,
        avatar: 'P',
        isPM: true
      });
    }

    // Add CAS collaborators if available
    if (workspace.casCollaborators && workspace.casCollaborators.length > 0) {
      console.log('🟣 Adding CAS collaborators:', workspace.casCollaborators.length);
      for (const casCollaborator of workspace.casCollaborators) {
        collaborators.push({
          vendorId: casCollaborator.userId,
          name: casCollaborator.name || 'CAS Member',
          email: casCollaborator.email || 'N/A',
          specialization: casCollaborator.casUnit || 'CAS Services',
          accessLevel: casCollaborator.accessLevel || 'CAS Unit',
          status: casCollaborator.status || 'active',
          lastActivity: casCollaborator.lastActivity || { 
            action: 'invited', 
            timestamp: casCollaborator.invitedAt,
            description: 'Invited to collaborative workspace'
          },
          joinedAt: casCollaborator.invitedAt,
          avatar: (casCollaborator.name?.charAt(0) || 'C').toUpperCase(),
          isCAS: true,
          casUnit: casCollaborator.casUnit
        });
      }
    }

    res.status(200).json({
      success: true,
      collaborators,
      totalCount: collaborators.length,
      workspace: {
        id: workspace.workspaceId,
        title: workspace.title,
        lastUpdated: workspace.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Error fetching workspace collaborators:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch collaborators', 
      error: error.message 
    });
  }
};

// Update workspace permissions
export const updateWorkspacePermissions = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { permissions } = req.body;

    console.log('🔐 Updating workspace permissions:', { workspaceId, permissions });

    // Get current workspace
    const workspace = await DynamoWorkspace.getWorkspaceById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }

    // Prefer model update to resolve correct PK
    const updated = await DynamoWorkspace.updateWorkspace(workspaceId, {
      accessControl: {
        ...(workspace.accessControl || {}),
        permissions: permissions
      }
    });

    console.log('✅ Workspace permissions updated successfully');

    res.status(200).json({
      success: true,
      message: 'Permissions updated successfully',
      permissions: permissions,
      workspace: updated
    });

  } catch (error) {
    console.error('❌ Error updating workspace permissions:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update permissions', 
      error: error.message 
    });
  }
};

// Helper function to get vendor's last activity
async function getVendorLastActivity(vendorId, workspaceId) {
  try {
    // This is a simplified version - you can enhance with actual activity tracking
    // For now, we'll return a mock activity based on workspace updates
    
    // You could query a separate activity log table here
    // For now, return a basic activity
    return {
      action: 'Viewed workspace',
      timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(), // Random time within last day
      description: 'Last seen in collaborative workspace'
    };
  } catch (error) {
    console.error('Error getting vendor activity:', error);
    return {
      action: 'Unknown',
      timestamp: null,
      description: 'Activity data unavailable'
    };
  }
}
