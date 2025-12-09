import * as DynamoWorkspace from '../../workspace/models/DynamoWorkspace.js';
import * as DynamoLead from '../models/DynamoLead.js';
import { sendLeadNotification } from '../../../websocket/notificationSocket.js';
import { v4 as uuidv4 } from 'uuid';

// Create workspace for PM project with vendor collaboration
export const createWorkspaceForPM = async (req, res) => {
  try {
    const { 
      projectId, 
      pmId, 
      projectName, 
      invitedVendors = [], 
      workspaceTemplate = 'default' 
    } = req.body;

    console.log('🚀 PM Integration: Creating workspace for project:', projectId);

    // Create collaborative workspace
    const workspaceData = {
      projectId,
      title: `${projectName} - Collaborative Workspace`,
      description: `PM-Vendor collaborative workspace for ${projectName}`,
      
      // Set PM as owner, vendors as collaborators
      vendorId: pmId, // For compatibility with existing system
      isShared: true,
      sharedWith: invitedVendors.map(v => v.vendorId),
      
      // RBAC settings
      accessControl: {
        owner: pmId,
        collaborators: invitedVendors.map(v => v.vendorId),
        permissions: {
          canEdit: [pmId], // PM can edit everything
          canComment: [pmId, ...invitedVendors.map(v => v.vendorId)], // All can comment
          canViewFiles: [pmId, ...invitedVendors.map(v => v.vendorId)], // All can view files
          canCreateTasks: [pmId], // Only PM can create tasks
          canAssignTasks: [pmId], // Only PM can assign tasks
          canUpdateTaskStatus: invitedVendors.map(v => v.vendorId) // Vendors can update their task status
        }
      },

      // Pre-populate with template based on project type
      nodes: getWorkspaceTemplate(workspaceTemplate),
      layers: getDefaultLayers(workspaceTemplate),
      
      // Project metadata
      projectMetadata: {
        pmId,
        projectName,
        invitedVendors,
        workspaceTemplate,
        createdBy: 'pm_system'
      },

      status: 'active'
    };

    const workspace = await DynamoWorkspace.createWorkspace(workspaceData);

    // Send notifications to invited vendors
    for (const vendor of invitedVendors) {
      try {
        // Create a lead/invitation for each vendor
        const leadData = {
          name: `Collaborative Project: ${projectName}`,
          description: `You've been invited to collaborate on ${projectName}`,
          assignedVendorId: vendor.vendorId,
          sentByPmId: pmId,
          status: 'sent',
          projectId,
          workspaceId: workspace.workspaceId,
          invitationType: 'collaboration',
          budget: 'TBD',
          duration: 'TBD'
        };

        const lead = await DynamoLead.createLead(leadData);

        // Send real-time notification
        sendLeadNotification(vendor.vendorId, {
          ...lead,
          type: 'collaboration_invite',
          workspaceId: workspace.workspaceId,
          pmName: req.body.pmName || 'Project Manager',
          requiresAction: true
        });

        console.log(`✅ Sent collaboration invite to vendor: ${vendor.vendorId}`);
      } catch (notificationError) {
        console.error(`❌ Failed to notify vendor ${vendor.vendorId}:`, notificationError);
      }
    }

    res.json({
      success: true,
      workspaceId: workspace.workspaceId,
      accessUrl: `/VendorDashboard/workspace/${workspace.workspaceId}`,
      invitedVendors: invitedVendors.length,
      message: 'Collaborative workspace created successfully'
    });

  } catch (error) {
    console.error('❌ PM Integration: Error creating workspace:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

// Get workspace info for PM
export const getWorkspaceForPM = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { pmId } = req.query;

    const workspace = await DynamoWorkspace.getWorkspaceById(workspaceId);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Check if user has PM access
    const hasAccess = workspace.accessControl?.owner === pmId || 
                     workspace.vendorId === pmId ||
                     workspace.sharedWith?.includes(pmId);

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Add PM-specific metadata
    const pmWorkspace = {
      ...workspace,
      userRole: workspace.accessControl?.owner === pmId ? 'owner' : 'collaborator',
      permissions: workspace.accessControl?.permissions || {},
      collaborators: workspace.sharedWith || [],
      projectMetadata: workspace.projectMetadata || {}
    };

    res.json(pmWorkspace);
  } catch (error) {
    console.error('Error getting workspace for PM:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update workspace with PM-specific permissions
export const updateWorkspacePermissions = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { pmId, permissions, newCollaborators } = req.body;

    const workspace = await DynamoWorkspace.getWorkspaceById(workspaceId);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Verify PM ownership
    if (workspace.accessControl?.owner !== pmId && workspace.vendorId !== pmId) {
      return res.status(403).json({ error: 'Only workspace owner can update permissions' });
    }

    // Update permissions
    const updatedData = {
      accessControl: {
        ...workspace.accessControl,
        permissions: {
          ...workspace.accessControl?.permissions,
          ...permissions
        }
      }
    };

    // Add new collaborators if provided
    if (newCollaborators && newCollaborators.length > 0) {
      updatedData.sharedWith = [
        ...(workspace.sharedWith || []),
        ...newCollaborators.filter(c => !workspace.sharedWith?.includes(c))
      ];
    }

    const updatedWorkspace = await DynamoWorkspace.updateWorkspace(workspaceId, updatedData);

    res.json({
      success: true,
      workspace: updatedWorkspace,
      message: 'Permissions updated successfully'
    });

  } catch (error) {
    console.error('Error updating workspace permissions:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get vendor directory for PM to browse
export const getVendorDirectory = async (req, res) => {
  try {
    const { search, location, specialization, minRating } = req.query;

    // Mock vendor directory for testing
    const mockVendors = [
      {
        id: 'DHA-250509-564',
        name: 'Dhanush Vendor',
        email: 'dhanush@vendor.com',
        companyName: 'Dhanush Construction',
        specialization: 'Construction',
        location: 'Mumbai',
        rating: 4.5,
        completedProjects: 25,
        status: 'approved'
      },
      {
        id: 'vendor-002',
        name: 'Sarah Wilson',
        email: 'sarah@electrical.com', 
        companyName: 'Wilson Electrical',
        specialization: 'Electrical',
        location: 'Delhi',
        rating: 4.8,
        completedProjects: 40,
        status: 'approved'
      },
      {
        id: 'vendor-003',
        name: 'Mike Johnson',
        email: 'mike@plumbing.com',
        companyName: 'Johnson Plumbing',
        specialization: 'Plumbing',
        location: 'Bangalore',
        rating: 4.2,
        completedProjects: 18,
        status: 'approved'
      }
    ];

    // Apply filters
    let filteredVendors = mockVendors.filter(v => v.status === 'approved');

    if (search) {
      filteredVendors = filteredVendors.filter(v => 
        v.name.toLowerCase().includes(search.toLowerCase()) ||
        v.companyName.toLowerCase().includes(search.toLowerCase()) ||
        v.specialization.toLowerCase().includes(search.toLowerCase())
      );
    }

    if (location) {
      filteredVendors = filteredVendors.filter(v => 
        v.location.toLowerCase() === location.toLowerCase()
      );
    }

    if (specialization) {
      filteredVendors = filteredVendors.filter(v => 
        v.specialization.toLowerCase() === specialization.toLowerCase()
      );
    }

    if (minRating) {
      filteredVendors = filteredVendors.filter(v => v.rating >= parseFloat(minRating));
    }

    res.json({
      success: true,
      vendors: filteredVendors,
      total: filteredVendors.length
    });

  } catch (error) {
    console.error('Error getting vendor directory:', error);
    res.status(500).json({ error: error.message });
  }
};

// Helper function to get workspace template
const getWorkspaceTemplate = (template) => {
  const templates = {
    construction: [
      {
        id: 'planning-node',
        type: 'textNode',
        position: { x: 100, y: 100 },
        data: { 
          content: 'Project Planning Phase',
          backgroundColor: '#dbeafe',
          textColor: '#1e40af'
        }
      },
      {
        id: 'execution-node',
        type: 'textNode', 
        position: { x: 300, y: 100 },
        data: { 
          content: 'Execution Phase',
          backgroundColor: '#dcfce7',
          textColor: '#166534'
        }
      },
      {
        id: 'review-node',
        type: 'textNode',
        position: { x: 500, y: 100 },
        data: { 
          content: 'Review & Handover',
          backgroundColor: '#fef3c7',
          textColor: '#92400e'
        }
      }
    ],
    default: [
      {
        id: 'welcome-node',
        type: 'textNode',
        position: { x: 250, y: 150 },
        data: { 
          content: 'Welcome to Collaborative Workspace\n\nPM and Vendors can work together here!',
          backgroundColor: '#f3f4f6',
          textColor: '#374151'
        }
      }
    ]
  };

  return templates[template] || templates.default;
};

// Helper function to get default layers
const getDefaultLayers = (template) => {
  const layers = {
    construction: [
      {
        id: 1,
        name: 'Planning & Design',
        type: 'folder',
        color: 'bg-blue-500',
        items: []
      },
      {
        id: 2,
        name: 'Execution & Progress',
        type: 'folder', 
        color: 'bg-green-500',
        items: []
      },
      {
        id: 3,
        name: 'Quality & Review',
        type: 'folder',
        color: 'bg-yellow-500',
        items: []
      }
    ],
    default: [
      {
        id: 1,
        name: 'Collaboration',
        type: 'folder',
        color: 'bg-purple-500',
        items: []
      },
      {
        id: 2,
        name: 'Resources',
        type: 'folder',
        color: 'bg-indigo-500', 
        items: []
      }
    ]
  };

  return layers[template] || layers.default;
};
