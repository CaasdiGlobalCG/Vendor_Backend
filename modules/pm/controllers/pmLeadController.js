import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { dynamoDB } from '../../../config/aws.js';
import { notifyVendorOfPMDecision, notifyVendorOfNewLead, notifyWorkspaceAccessGranted } from '../../../websocket/notificationSocket.js';

const LEAD_INVITATIONS_TABLE = 'lead_invitations_table';
const PM_PROJECTS_TABLE = 'pm_projects_table';

// PM: Send leads to multiple vendors
export const sendLeadsToVendors = async (req, res) => {
  try {
    const { pmId } = req.pmUser; // From JWT token
    const { projectId, vendorIds, leadDetails } = req.body;

    console.log('📤 PM sending leads:', { projectId, vendorCount: vendorIds?.length });

    // Validation
    if (!projectId || !vendorIds || !Array.isArray(vendorIds) || vendorIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Project ID and vendor IDs array are required'
      });
    }

    if (!leadDetails || !leadDetails.leadTitle || !leadDetails.leadDescription) {
      return res.status(400).json({
        success: false,
        error: 'Lead title and description are required'
      });
    }

    // Verify project belongs to PM
    const project = await dynamoDB.get({
      TableName: PM_PROJECTS_TABLE,
      Key: { projectId }
    }).promise();

    if (!project.Item || project.Item.pmId !== pmId) {
      return res.status(403).json({
        success: false,
        error: 'Project not found or access denied'
      });
    }

    // Fetch real vendor details from vendors table
    console.log('📖 Fetching vendor details from vendors table...');
    const vendorDirectory = {};
    
    try {
      // Fetch vendors for the provided vendor IDs
      for (const vendorId of vendorIds) {
        try {
          const vendorResult = await dynamoDB.get({
            TableName: 'vendors',
            Key: { vendorId: vendorId }
          }).promise();
          
          if (vendorResult.Item) {
            const vendor = vendorResult.Item;
            vendorDirectory[vendorId] = {
              name: vendor.name || vendor.firstName + ' ' + (vendor.lastName || ''),
              email: vendor.email,
              companyName: vendor.companyName || vendor.company || 'Unknown Company',
              specialization: vendor.specialization || vendor.expertise || 'General'
            };
            console.log(`✅ Found vendor: ${vendorId} - ${vendorDirectory[vendorId].name}`);
          } else {
            console.warn(`⚠️ Vendor not found in database: ${vendorId}`);
            // Add a fallback entry so the process doesn't fail
            vendorDirectory[vendorId] = {
              name: 'Unknown Vendor',
              email: 'unknown@vendor.com',
              companyName: 'Unknown Company',
              specialization: 'General'
            };
          }
        } catch (vendorError) {
          console.error(`❌ Error fetching vendor ${vendorId}:`, vendorError);
          // Add a fallback entry
          vendorDirectory[vendorId] = {
            name: 'Unknown Vendor',
            email: 'unknown@vendor.com',
            companyName: 'Unknown Company',
            specialization: 'General'
          };
        }
      }
      
      console.log('📋 Vendor directory loaded:', Object.keys(vendorDirectory).length, 'vendors');
    } catch (error) {
      console.error('❌ Error building vendor directory:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch vendor information'
      });
    }

    const createdLeads = [];
    const now = new Date().toISOString();

    // Create lead invitation for each vendor
    for (const vendorId of vendorIds) {
      const vendorDetails = vendorDirectory[vendorId];
      if (!vendorDetails) {
        console.warn(`⚠️ Vendor not found: ${vendorId}`);
        continue;
      }

      const leadId = `LEAD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const leadInvitation = {
        leadId,
        projectId,
        pmId,
        vendorId,
        
        // Lead details
        leadTitle: leadDetails.leadTitle,
        leadDescription: leadDetails.leadDescription,
        specialization: leadDetails.specialization || vendorDetails.specialization,
        estimatedBudget: leadDetails.estimatedBudget || 'TBD',
        estimatedTimeline: leadDetails.estimatedTimeline || 'TBD',
        
        // Status workflow
        status: 'sent',
        
        // Empty responses initially
        vendorResponse: null,
        pmDecision: null,
        
        // Timestamps
        sentAt: now,
        updatedAt: now,
        
        // Metadata
        priority: leadDetails.priority || 'medium',
        tags: leadDetails.tags || [],
        
        // Reference data
        vendorDetails: {
          name: vendorDetails.name,
          email: vendorDetails.email,
          companyName: vendorDetails.companyName,
          specialization: vendorDetails.specialization
        },
        
        projectDetails: {
          name: project.Item.name,
          location: project.Item.location || '',
          category: project.Item.category || 'General'
        }
      };

      // Save to database
      await dynamoDB.put({
        TableName: LEAD_INVITATIONS_TABLE,
        Item: leadInvitation
      }).promise();

      createdLeads.push({
        leadId,
        vendorId,
        vendorName: vendorDetails.name,
        companyName: vendorDetails.companyName,
        status: 'sent'
      });

      console.log(`✅ Lead sent to ${vendorDetails.name}: ${leadId}`);
      
      // Send real-time notification to vendor
      try {
        const notificationData = {
          leadId: leadId,
          projectId: projectId,
          pmId: pmId,
          pmName: 'Project Manager', // Could be enhanced to get actual PM name
          leadTitle: leadDetails.leadTitle,
          specialization: leadDetails.specialization || vendorDetails.specialization,
          estimatedBudget: leadDetails.estimatedBudget || 'TBD',
          estimatedTimeline: leadDetails.estimatedTimeline || 'TBD',
          priority: leadDetails.priority || 'medium'
        };
        
        notifyVendorOfNewLead(vendorId, notificationData);
        console.log('🔔 Real-time notification sent to vendor:', vendorId);
      } catch (notificationError) {
        console.error('⚠️ Failed to send notification to vendor:', notificationError);
        // Don't fail the lead creation if notification fails
      }
    }

    // Update project with invited vendors
    const existingInvitedVendors = project.Item.invitedVendors || [];
    const newInvitedVendors = vendorIds.map(vendorId => {
      const vendorDetails = vendorDirectory[vendorId];
      return {
        vendorId,
        name: vendorDetails?.name || 'Unknown',
        email: vendorDetails?.email || '',
        companyName: vendorDetails?.companyName || '',
        specialization: vendorDetails?.specialization || '',
        status: 'pending',
        invitedAt: now,
        leadId: createdLeads.find(l => l.vendorId === vendorId)?.leadId || null
      };
    }).filter(v => !existingInvitedVendors.find(existing => existing.vendorId === v.vendorId));

    if (newInvitedVendors.length > 0) {
      await dynamoDB.update({
        TableName: PM_PROJECTS_TABLE,
        Key: { projectId },
        UpdateExpression: 'SET invitedVendors = list_append(if_not_exists(invitedVendors, :empty_list), :newVendors), updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':newVendors': newInvitedVendors,
          ':empty_list': [],
          ':updatedAt': now
        }
      }).promise();
    }

    console.log(`✅ Successfully sent ${createdLeads.length} leads for project ${projectId}`);

    res.json({
      success: true,
      message: `Successfully sent leads to ${createdLeads.length} vendors`,
      leads: createdLeads,
      projectId,
      sentAt: now
    });

  } catch (error) {
    console.error('❌ Error sending leads to vendors:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send leads to vendors'
    });
  }
};

// PM: Get all leads sent by PM
export const getPMLeads = async (req, res) => {
  try {
    const { pmId } = req.pmUser;
    const { projectId, status, limit = 50 } = req.query;

    console.log('📋 Getting PM leads:', { pmId, projectId, status });

    let params = {
      TableName: LEAD_INVITATIONS_TABLE,
      IndexName: 'PMIdIndex',
      KeyConditionExpression: 'pmId = :pmId',
      ExpressionAttributeValues: {
        ':pmId': pmId
      },
      ScanIndexForward: false, // Latest first
      Limit: parseInt(limit)
    };

    // Add filters
    const filterExpressions = [];
    if (projectId) {
      filterExpressions.push('projectId = :projectId');
      params.ExpressionAttributeValues[':projectId'] = projectId;
    }
    if (status) {
      filterExpressions.push('#status = :status');
      params.ExpressionAttributeNames = { '#status': 'status' };
      params.ExpressionAttributeValues[':status'] = status;
    }

    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
    }

    const result = await dynamoDB.query(params).promise();

    // Transform for frontend
    const leads = result.Items.map(lead => ({
      leadId: lead.leadId,
      projectId: lead.projectId,
      projectName: lead.projectDetails?.name || 'Unknown Project',
      vendorId: lead.vendorId,
      vendorName: lead.vendorDetails?.name || 'Unknown Vendor',
      companyName: lead.vendorDetails?.companyName || '',
      leadTitle: lead.leadTitle,
      leadDescription: lead.leadDescription,
      specialization: lead.specialization,
      estimatedBudget: lead.estimatedBudget,
      estimatedTimeline: lead.estimatedTimeline,
      status: lead.status,
      priority: lead.priority,
      sentAt: lead.sentAt,
      updatedAt: lead.updatedAt,
      vendorResponse: lead.vendorResponse,
      pmDecision: lead.pmDecision,
      tags: lead.tags || []
    }));

    console.log(`✅ Found ${leads.length} leads for PM ${pmId}`);

    res.json({
      success: true,
      leads,
      count: leads.length,
      hasMore: !!result.LastEvaluatedKey
    });

  } catch (error) {
    console.error('❌ Error getting PM leads:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get leads'
    });
  }
};

// PM: Get leads for specific project
export const getProjectLeads = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { pmId } = req.pmUser;

    console.log('📋 Getting project leads:', { projectId, pmId });

    // Verify project belongs to PM
    const project = await dynamoDB.get({
      TableName: PM_PROJECTS_TABLE,
      Key: { projectId }
    }).promise();

    if (!project.Item || project.Item.pmId !== pmId) {
      return res.status(403).json({
        success: false,
        error: 'Project not found or access denied'
      });
    }

    // Get leads for this project
    const result = await dynamoDB.query({
      TableName: LEAD_INVITATIONS_TABLE,
      IndexName: 'ProjectIdIndex',
      KeyConditionExpression: 'projectId = :projectId',
      ExpressionAttributeValues: {
        ':projectId': projectId
      },
      ScanIndexForward: false
    }).promise();

    // Transform and group by status
    const leads = result.Items.map(lead => ({
      leadId: lead.leadId,
      vendorId: lead.vendorId,
      vendorName: lead.vendorDetails?.name || 'Unknown Vendor',
      companyName: lead.vendorDetails?.companyName || '',
      leadTitle: lead.leadTitle,
      specialization: lead.specialization,
      estimatedBudget: lead.estimatedBudget,
      estimatedTimeline: lead.estimatedTimeline,
      status: lead.status,
      priority: lead.priority,
      sentAt: lead.sentAt,
      updatedAt: lead.updatedAt,
      vendorResponse: lead.vendorResponse,
      pmDecision: lead.pmDecision
    }));

    // Group by status for dashboard
    const leadsByStatus = {
      sent: leads.filter(l => l.status === 'sent'),
      vendor_accepted: leads.filter(l => l.status === 'vendor_accepted'),
      vendor_declined: leads.filter(l => l.status === 'vendor_declined'),
      pm_approved: leads.filter(l => l.status === 'pm_approved'),
      pm_rejected: leads.filter(l => l.status === 'pm_rejected')
    };

    console.log(`✅ Found ${leads.length} leads for project ${projectId}`);

    res.json({
      success: true,
      projectId,
      projectName: project.Item.name,
      leads,
      leadsByStatus,
      summary: {
        total: leads.length,
        pending: leadsByStatus.sent.length,
        awaitingApproval: leadsByStatus.vendor_accepted.length,
        approved: leadsByStatus.pm_approved.length,
        declined: leadsByStatus.vendor_declined.length + leadsByStatus.pm_rejected.length
      }
    });

  } catch (error) {
    console.error('❌ Error getting project leads:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get project leads'
    });
  }
};

// PM: Approve or reject vendor response
export const pmDecisionOnLead = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { pmId } = req.pmUser;
    const { approved, feedback, workspaceAccess = false } = req.body;

    console.log('⚖️ PM decision on lead:', { leadId, approved, pmId });

    // Validation
    if (typeof approved !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Approved status (true/false) is required'
      });
    }

    // Get lead
    const leadResult = await dynamoDB.get({
      TableName: LEAD_INVITATIONS_TABLE,
      Key: { leadId }
    }).promise();

    if (!leadResult.Item) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    const lead = leadResult.Item;

    // Verify PM owns this lead
    if (lead.pmId !== pmId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this lead'
      });
    }

    // Verify lead is in correct status
    if (lead.status !== 'vendor_accepted') {
      return res.status(400).json({
        success: false,
        error: 'Lead must be in vendor_accepted status for PM decision'
      });
    }

    const now = new Date().toISOString();
    const newStatus = approved ? 'pm_approved' : 'pm_rejected';

    // Update lead with PM decision
    const pmDecision = {
      decidedAt: now,
      approved,
      feedback: feedback || '',
      workspaceAccess: approved ? workspaceAccess : false
    };

    await dynamoDB.update({
      TableName: LEAD_INVITATIONS_TABLE,
      Key: { leadId },
      UpdateExpression: 'SET #status = :status, pmDecision = :pmDecision, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': newStatus,
        ':pmDecision': pmDecision,
        ':updatedAt': now
      }
    }).promise();

    // If approved, update project's approved vendors and create workspace if needed
    if (approved) {
      await dynamoDB.update({
        TableName: PM_PROJECTS_TABLE,
        Key: { projectId: lead.projectId },
        UpdateExpression: 'SET approvedVendors = list_append(if_not_exists(approvedVendors, :empty_list), :vendor), updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':vendor': [{
            vendorId: lead.vendorId,
            name: lead.vendorDetails?.name || 'Unknown',
            companyName: lead.vendorDetails?.companyName || '',
            specialization: lead.specialization,
            approvedAt: now,
            leadId: leadId,
            workspaceAccess: workspaceAccess
          }],
          ':empty_list': [],
          ':updatedAt': now
        }
      }).promise();

      // If workspace access is granted, create or update collaborative workspace
      if (workspaceAccess) {
        try {
          console.log('🏗️ Creating collaborative workspace for approved vendor');
          
          // Import workspace access controller
          const { createOrGetCollaborativeWorkspace } = await import('./workspaceAccessController.js');
          
          // Create workspace request object
          const workspaceReq = {
            body: {
              projectId: lead.projectId,
              pmId: pmId,
              vendorId: lead.vendorId,
              leadId: leadId,
              pmApproved: true // PM explicitly approved this vendor
            }
          };
          
          // Create collaborative workspace and capture the workspace ID
          let collaborativeWorkspaceId = null;
          const workspaceRes = {
            json: (data) => {
              console.log('✅ Workspace created:', data.workspace?.workspaceId);
              collaborativeWorkspaceId = data.workspace?.workspaceId;
              return data;
            },
            status: (code) => ({ json: (data) => console.error('❌ Workspace error:', data) })
          };
          
          // Create collaborative workspace
          await createOrGetCollaborativeWorkspace(workspaceReq, workspaceRes);
          
          // Update the project with the collaborative workspace ID
          if (collaborativeWorkspaceId) {
            try {
              console.log('🔄 Updating project with collaborative workspace ID:', collaborativeWorkspaceId);
              
              await dynamoDB.update({
                TableName: PM_PROJECTS_TABLE,
                Key: { projectId: lead.projectId },
                UpdateExpression: 'SET workspaceId = :workspaceId, workspaceCreated = :workspaceCreated, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                  ':workspaceId': collaborativeWorkspaceId,
                  ':workspaceCreated': true,
                  ':updatedAt': now
                }
              }).promise();
              
              console.log('✅ Project updated with collaborative workspace ID');
            } catch (updateError) {
              console.error('⚠️ Warning: Failed to update project with workspace ID:', updateError);
            }
          }
          
        } catch (workspaceError) {
          console.error('⚠️ Warning: Failed to create workspace, but lead approval succeeded:', workspaceError);
          // Don't fail the lead approval if workspace creation fails
        }
      }
    }

    console.log(`✅ PM ${approved ? 'approved' : 'rejected'} lead ${leadId}`);

    // Send real-time notification to vendor
    try {
      const notificationData = {
        leadId: leadId,
        projectId: lead.projectId,
        pmId: pmId,
        leadTitle: lead.leadTitle,
        pmDecision: pmDecision,
        workspaceId: approved && workspaceAccess ? 'WS-SAMPLE-001' : null // Would be dynamic in real system
      };
      
      notifyVendorOfPMDecision(lead.vendorId, notificationData);
      console.log('🔔 Real-time notification sent to vendor:', lead.vendorId);
    } catch (notificationError) {
      console.error('⚠️ Failed to send notification to vendor:', notificationError);
      // Don't fail the PM decision if notification fails
    }

    res.json({
      success: true,
      message: `Lead ${approved ? 'approved' : 'rejected'} successfully`,
      leadId,
      status: newStatus,
      pmDecision,
      workspaceAccess: approved ? workspaceAccess : false
    });

  } catch (error) {
    console.error('❌ Error processing PM decision:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process PM decision'
    });
  }
};

// Get vendor directory (for PM to select vendors)
export const getVendorDirectory = async (req, res) => {
  try {
    const { search, specialization, location, minRating } = req.query;

    console.log('📖 Getting vendor directory from vendors table:', { search, specialization, location });

    // Fetch all vendors from the vendors table
    const vendorsResult = await dynamoDB.scan({
      TableName: 'vendors'
    }).promise();

    console.log(`📋 Found ${vendorsResult.Items.length} vendors in database`);

    // Transform DynamoDB vendor data to expected format
    let allVendors = vendorsResult.Items.map(vendor => ({
      vendorId: vendor.vendorId || vendor.id,
      name: vendor.name || `${vendor.firstName || ''} ${vendor.lastName || ''}`.trim() || 'Unknown Name',
      email: vendor.email || 'no-email@vendor.com',
      companyName: vendor.companyName || vendor.company || 'Unknown Company',
      specialization: vendor.specialization || vendor.expertise || vendor.category || 'General',
      location: vendor.location || vendor.city || vendor.address || 'Unknown Location',
      rating: vendor.rating || 4.0,
      completedProjects: vendor.completedProjects || vendor.projectsCompleted || 0,
      status: vendor.status || 'approved',
      description: vendor.description || vendor.bio || `Professional ${vendor.specialization || 'service'} provider`,
      certifications: vendor.certifications || vendor.certificates || [],
      yearsOfExperience: vendor.yearsOfExperience || vendor.experience || 1,
      phone: vendor.phone || vendor.phoneNumber,
      website: vendor.website,
      profileImage: vendor.profileImage || vendor.avatar
    }));

    console.log(`✅ Transformed ${allVendors.length} vendor records`);

    // Apply filters
    let filteredVendors = allVendors.filter(v => v.status === 'approved');

    if (search) {
      const searchLower = search.toLowerCase();
      filteredVendors = filteredVendors.filter(v => 
        v.name.toLowerCase().includes(searchLower) ||
        v.companyName.toLowerCase().includes(searchLower) ||
        v.specialization.toLowerCase().includes(searchLower) ||
        v.description.toLowerCase().includes(searchLower)
      );
    }

    if (specialization) {
      filteredVendors = filteredVendors.filter(v => 
        v.specialization.toLowerCase() === specialization.toLowerCase()
      );
    }

    if (location) {
      filteredVendors = filteredVendors.filter(v => 
        v.location.toLowerCase() === location.toLowerCase()
      );
    }

    if (minRating) {
      filteredVendors = filteredVendors.filter(v => v.rating >= parseFloat(minRating));
    }

    console.log(`✅ Found ${filteredVendors.length} vendors in directory`);

    res.json({
      success: true,
      vendors: filteredVendors,
      total: filteredVendors.length,
      filters: { search, specialization, location, minRating }
    });

  } catch (error) {
    console.error('❌ Error getting vendor directory:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get vendor directory'
    });
  }
};
