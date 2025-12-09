import AWS from 'aws-sdk';
import { dynamoDB, s3 } from '../../../config/aws.js';
import { notifyPMOfVendorResponse } from '../../../websocket/notificationSocket.js';

const LEAD_INVITATIONS_TABLE = 'lead_invitations_table';

// Vendor: Get all leads received by vendor
export const getVendorLeads = async (req, res) => {
  try {
    const { vendorId } = req.body; // From vendor authentication
    const { status, limit = 50 } = req.query;

    console.log('📬 Getting vendor leads:', { vendorId, status });

    let params = {
      TableName: LEAD_INVITATIONS_TABLE,
      IndexName: 'VendorIdIndex',
      KeyConditionExpression: 'vendorId = :vendorId',
      ExpressionAttributeValues: {
        ':vendorId': vendorId
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

    const result = await dynamoDB.query(params).promise();

    // Transform for frontend
    const leads = result.Items.map(lead => ({
      leadId: lead.leadId,
      projectId: lead.projectId,
      projectName: lead.projectDetails?.name || 'Unknown Project',
      projectLocation: lead.projectDetails?.location || '',
      projectCategory: lead.projectDetails?.category || '',
      pmId: lead.pmId,
      vendorId: lead.vendorId, // Include vendorId for frontend filtering
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
      tags: lead.tags || [],
      // Expose BOQ attachment metadata for frontend download links
      boqAttachment: lead.boqAttachment || null
    }));

    // Group by status for dashboard
    const leadsByStatus = {
      sent: leads.filter(l => l.status === 'sent'),
      vendor_accepted: leads.filter(l => l.status === 'vendor_accepted'),
      vendor_declined: leads.filter(l => l.status === 'vendor_declined'),
      pm_approved: leads.filter(l => l.status === 'pm_approved'),
      pm_rejected: leads.filter(l => l.status === 'pm_rejected')
    };

    console.log(`✅ Found ${leads.length} leads for vendor ${vendorId}`);

    res.json({
      success: true,
      leads,
      leadsByStatus,
      summary: {
        total: leads.length,
        pending: leadsByStatus.sent.length,
        responded: leadsByStatus.vendor_accepted.length + leadsByStatus.vendor_declined.length,
        approved: leadsByStatus.pm_approved.length,
        rejected: leadsByStatus.pm_rejected.length
      },
      count: leads.length,
      hasMore: !!result.LastEvaluatedKey
    });

  } catch (error) {
    console.error('❌ Error getting vendor leads:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get vendor leads'
    });
  }
};

// Vendor: Get single lead details
export const getVendorLead = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { vendorId } = req.body; // From vendor authentication

    console.log('📄 Getting vendor lead details:', { leadId, vendorId });

    const result = await dynamoDB.get({
      TableName: LEAD_INVITATIONS_TABLE,
      Key: { leadId }
    }).promise();

    if (!result.Item) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    const lead = result.Item;

    // Verify lead belongs to this vendor
    if (lead.vendorId !== vendorId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this lead'
      });
    }

    // Transform for frontend
    const leadDetails = {
      leadId: lead.leadId,
      projectId: lead.projectId,
      projectName: lead.projectDetails?.name || 'Unknown Project',
      projectLocation: lead.projectDetails?.location || '',
      projectCategory: lead.projectDetails?.category || '',
      pmId: lead.pmId,
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
      tags: lead.tags || [],
      // Include BOQ attachment metadata for detailed views
      boqAttachment: lead.boqAttachment || null
    };

    console.log('✅ Lead details retrieved:', leadId);

    res.json({
      success: true,
      lead: leadDetails
    });

  } catch (error) {
    console.error('❌ Error getting vendor lead details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get lead details'
    });
  }
};

// Vendor: Get signed BOQ download URL for a lead
export const getVendorLeadBoqUrl = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { vendorId } = req.body;

    console.log('📄 Generating BOQ download URL for lead:', { leadId, vendorId });

    const result = await dynamoDB.get({
      TableName: LEAD_INVITATIONS_TABLE,
      Key: { leadId }
    }).promise();

    if (!result.Item) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    const lead = result.Item;

    // Verify lead belongs to this vendor
    if (vendorId && lead.vendorId !== vendorId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this lead'
      });
    }

    if (!lead.boqAttachment || !lead.boqAttachment.bucket || !lead.boqAttachment.key) {
      return res.status(404).json({
        success: false,
        error: 'No BOQ attachment found for this lead'
      });
    }

    const params = {
      Bucket: lead.boqAttachment.bucket,
      Key: lead.boqAttachment.key,
      Expires: 60 * 10 // 10 minutes
    };

    const downloadUrl = s3.getSignedUrl('getObject', params);

    res.status(200).json({
      success: true,
      downloadUrl,
      fileName: lead.boqAttachment.fileName || lead.boqAttachment.key.split('/').pop(),
      contentType: lead.boqAttachment.mimeType || 'application/pdf'
    });

  } catch (error) {
    console.error('❌ Error generating BOQ download URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate BOQ download URL'
    });
  }
};

// Vendor: Upload a quotation for a lead and store it in vendor_quotes_to_pm
export const uploadLeadQuotation = async (req, res) => {
  try {
    const { leadId } = req.params;
    const {
      vendorId,
      pmId,
      pdfUrl,
      customerName,
      customerDetails = {},
      billingAddress = {},
      shippingAddress = {},
      gstin = '',
      items = [],
      subtotal = 0,
      cgst = 0,
      sgst = 0,
      igst = 0,
      totalCgst,
      totalSgst,
      totalIgst,
      totalTax = 0,
      discount = 0,
      total = 0,
      customerNotes = '',
      termsAndConditions = '',
      quotationDate,
      expiryDate
    } = req.body;

    if (!vendorId || !pdfUrl) {
      return res.status(400).json({
        success: false,
        error: 'vendorId and pdfUrl are required'
      });
    }

    console.log('🧾 Uploading lead quotation to vendor_quotes_to_pm:', {
      leadId,
      vendorId,
      pmId
    });

    // Load lead to validate and enrich quotation data
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

    if (lead.vendorId && lead.vendorId !== vendorId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this lead'
      });
    }

    const now = new Date().toISOString();
    const quotationId =
      req.body.quotationId ||
      `QT-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const quoteItem = {
      vendorId,
      quotationId,
      // Link back to lead / project
      leadId,
      projectId: lead.projectId,
      customQuoteId: req.body.customQuoteId || null,
      customerName:
        customerName ||
        lead.projectDetails?.name ||
        lead.vendorDetails?.companyName ||
        'Unknown Customer',
      customerDetails: Object.keys(customerDetails).length
        ? customerDetails
        : lead.vendorDetails || {},
      quotationDate: quotationDate || now.split('T')[0],
      expiryDate: expiryDate || null,
      billingAddress,
      shippingAddress,
      gstin,
      items,
      subtotal,
      cgst,
      sgst,
      igst,
      totalCgst: totalCgst ?? cgst,
      totalSgst: totalSgst ?? sgst,
      totalIgst: totalIgst ?? igst,
      totalTax,
      discount,
      total,
      customerNotes,
      termsAndConditions,
      status: 'sent to pm for review',
      sentToPmAt: now,
      pmReviewedAt: null,
      pmFeedback: null,
      pmId: pmId || lead.pmId || null,
      pdfUrl,
      createdAt: now,
      updatedAt: now
    };

    await dynamoDB
      .put({
        TableName: 'vendor_quotes_to_pm',
        Item: quoteItem
      })
      .promise();

    console.log(
      `✅ Lead quotation ${quotationId} stored in vendor_quotes_to_pm for vendor ${vendorId}`
    );

    res.status(201).json({
      success: true,
      quotation: quoteItem
    });
  } catch (error) {
    console.error('❌ Error uploading lead quotation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload quotation'
    });
  }
};

// Vendor: Respond to lead (accept/decline with proposal)
export const respondToLead = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { vendorId } = req.body; // From vendor authentication
    const { 
      accepted, 
      message, 
      proposedBudget, 
      proposedTimeline, 
      attachments = [] 
    } = req.body;

    console.log('💬 Vendor responding to lead:', { leadId, accepted, vendorId });

    // Validation
    if (typeof accepted !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Accepted status (true/false) is required'
      });
    }

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Response message is required'
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

    // Verify lead belongs to this vendor
    if (lead.vendorId !== vendorId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this lead'
      });
    }

    // Verify lead is in correct status
    if (lead.status !== 'sent') {
      return res.status(400).json({
        success: false,
        error: 'Lead must be in sent status to respond'
      });
    }

    const now = new Date().toISOString();
    const newStatus = accepted ? 'vendor_accepted' : 'vendor_declined';

    // Create vendor response
    const vendorResponse = {
      acceptedAt: now,
      accepted,
      message: message.trim(),
      proposedBudget: accepted ? (proposedBudget || lead.estimatedBudget) : null,
      proposedTimeline: accepted ? (proposedTimeline || lead.estimatedTimeline) : null,
      attachments: attachments || []
    };

    // Update lead with vendor response
    await dynamoDB.update({
      TableName: LEAD_INVITATIONS_TABLE,
      Key: { leadId },
      UpdateExpression: 'SET #status = :status, vendorResponse = :vendorResponse, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': newStatus,
        ':vendorResponse': vendorResponse,
        ':updatedAt': now
      }
    }).promise();

    console.log(`✅ Vendor ${accepted ? 'accepted' : 'declined'} lead ${leadId}`);

    // Send real-time notification to PM
    try {
      const notificationData = {
        leadId: leadId,
        projectId: lead.projectId,
        vendorId: vendorId,
        vendorName: lead.vendorDetails?.name || 'Unknown Vendor',
        leadTitle: lead.leadTitle,
        accepted: accepted,
        proposedBudget: proposedBudget,
        proposedTimeline: proposedTimeline,
        message: message
      };
      
      notifyPMOfVendorResponse(lead.pmId, notificationData);
      console.log('🔔 Real-time notification sent to PM:', lead.pmId);
    } catch (notificationError) {
      console.error('⚠️ Failed to send notification to PM:', notificationError);
      // Don't fail the response if notification fails
    }

    res.json({
      success: true,
      message: `Lead ${accepted ? 'accepted' : 'declined'} successfully`,
      leadId,
      status: newStatus,
      vendorResponse,
      respondedAt: now
    });

  } catch (error) {
    console.error('❌ Error responding to lead:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to respond to lead'
    });
  }
};

// Vendor: Update response to lead (if still in vendor_accepted status)
export const updateLeadResponse = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { vendorId } = req.body; // From vendor authentication
    const { 
      message, 
      proposedBudget, 
      proposedTimeline, 
      attachments 
    } = req.body;

    console.log('📝 Vendor updating lead response:', { leadId, vendorId });

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

    // Verify lead belongs to this vendor
    if (lead.vendorId !== vendorId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this lead'
      });
    }

    // Verify lead is in correct status
    if (lead.status !== 'vendor_accepted') {
      return res.status(400).json({
        success: false,
        error: 'Can only update response for accepted leads'
      });
    }

    const now = new Date().toISOString();

    // Update vendor response
    const updatedResponse = {
      ...lead.vendorResponse,
      message: message || lead.vendorResponse.message,
      proposedBudget: proposedBudget || lead.vendorResponse.proposedBudget,
      proposedTimeline: proposedTimeline || lead.vendorResponse.proposedTimeline,
      attachments: attachments || lead.vendorResponse.attachments,
      updatedAt: now
    };

    await dynamoDB.update({
      TableName: LEAD_INVITATIONS_TABLE,
      Key: { leadId },
      UpdateExpression: 'SET vendorResponse = :vendorResponse, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':vendorResponse': updatedResponse,
        ':updatedAt': now
      }
    }).promise();

    console.log(`✅ Vendor updated response for lead ${leadId}`);

    res.json({
      success: true,
      message: 'Lead response updated successfully',
      leadId,
      vendorResponse: updatedResponse,
      updatedAt: now
    });

  } catch (error) {
    console.error('❌ Error updating lead response:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update lead response'
    });
  }
};

// Get lead statistics for vendor dashboard
export const getVendorLeadStats = async (req, res) => {
  try {
    const { vendorId } = req.body; // From vendor authentication

    console.log('📊 Getting vendor lead stats:', { vendorId });

    // Get all leads for this vendor
    const result = await dynamoDB.query({
      TableName: LEAD_INVITATIONS_TABLE,
      IndexName: 'VendorIdIndex',
      KeyConditionExpression: 'vendorId = :vendorId',
      ExpressionAttributeValues: {
        ':vendorId': vendorId
      }
    }).promise();

    const leads = result.Items;

    // Calculate statistics
    const stats = {
      totalLeads: leads.length,
      leadsByStatus: {
        sent: leads.filter(l => l.status === 'sent').length,
        vendor_accepted: leads.filter(l => l.status === 'vendor_accepted').length,
        vendor_declined: leads.filter(l => l.status === 'vendor_declined').length,
        pm_approved: leads.filter(l => l.status === 'pm_approved').length,
        pm_rejected: leads.filter(l => l.status === 'pm_rejected').length
      },
      leadsByPriority: {
        high: leads.filter(l => l.priority === 'high').length,
        medium: leads.filter(l => l.priority === 'medium').length,
        low: leads.filter(l => l.priority === 'low').length
      },
      responseRate: leads.length > 0 ? 
        ((leads.filter(l => ['vendor_accepted', 'vendor_declined'].includes(l.status)).length / leads.length) * 100).toFixed(1) : 0,
      approvalRate: leads.length > 0 ? 
        ((leads.filter(l => l.status === 'pm_approved').length / leads.length) * 100).toFixed(1) : 0,
      recentLeads: leads
        .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
        .slice(0, 5)
        .map(lead => ({
          leadId: lead.leadId,
          projectName: lead.projectDetails?.name || 'Unknown Project',
          leadTitle: lead.leadTitle,
          status: lead.status,
          sentAt: lead.sentAt,
          priority: lead.priority
        }))
    };

    console.log(`✅ Lead stats calculated for vendor ${vendorId}`);

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('❌ Error getting vendor lead stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get lead statistics'
    });
  }
};
