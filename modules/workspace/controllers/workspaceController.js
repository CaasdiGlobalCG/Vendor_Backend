import { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand, ScanCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import PDFDocument from 'pdfkit';
import { getStreamAsBuffer } from 'get-stream';
import { uploadFileToS3 } from '../../../utils/s3Utils.js';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// Table names
const WORKSPACE_QUOTATIONS_TABLE = 'workspace_quotations';
const WORKSPACE_INVOICES_TABLE = 'workspace_invoices';
const WORKSPACE_CREDIT_NOTES_TABLE = 'workspace_credit_notes';
const WORKSPACE_PURCHASE_ORDERS_TABLE = 'workspace_purchase_orders';
const WORKSPACE_ITEMS_TABLE = 'workspace_items';
const WORKSPACE_CUSTOMERS_TABLE = 'workspace_customers';
const WORKSPACE_DELIVERY_CHALLANS_TABLE = 'workspace_delivery_challans';
const PM_PROJECTS_TABLE = 'pm_projects_table';

/**
 * Helper: find project context for a given workspaceId from pm_projects_table.
 * Returns an object containing { clientId, projectId }.
 * We assume workspaceId is unique per project; if multiple projects match,
 * the first match is used.
 */
const getProjectContextForWorkspace = async (workspaceId) => {
  if (!workspaceId) return null;

  try {
    const params = {
      TableName: PM_PROJECTS_TABLE,
      // workspaceId is not part of the key, so we use a Scan with a filter.
      // This is acceptable given the expected project volume; if it grows large,
      // consider adding a GSI on workspaceId.
      FilterExpression: '#ws = :ws',
      ExpressionAttributeNames: {
        '#ws': 'workspaceId'
      },
      ExpressionAttributeValues: {
        ':ws': { S: workspaceId }
      }
    };

    const result = await dbClient.send(new ScanCommand(params));
    if (!result.Items || result.Items.length === 0) {
      console.warn(`⚠️ No PM project found for workspaceId=${workspaceId} in ${PM_PROJECTS_TABLE}`);
      return null;
    }

    const project = unmarshall(result.Items[0]);
    const clientId = project.clientId || project.sourceClientId || null;
    const projectId = project.projectId || null;
    console.log(
      `🔗 Resolved project context for workspaceId=${workspaceId}:`,
      { clientId, projectId }
    );
    return { clientId: clientId || null, projectId: projectId || null };
  } catch (err) {
    console.error(`❌ Failed to resolve project context for workspaceId=${workspaceId}:`, err);
    return null;
  }
};

/**
 * ========================================
 * QUOTATIONS MANAGEMENT
 * ========================================
 */

/**
 * Create a new quotation for a vendor
 * @route POST /api/workspace/quotations
 * @access Private (Vendor only)
 */
const createQuotation = async (req, res) => {
  try {
    console.log('📋 CREATE QUOTATION - Request body:', req.body);
    console.log('📋 CREATE QUOTATION - User:', req.user);

    const {
      vendorId,
      customerId,
      customerName,
      quotationDate,
      expiryDate,
      billingAddress,
      shippingAddress,
      gstin,
      items,
      subtotal,
      cgst,
      sgst,
      igst,
      total,
      status,
      customQuoteId,
      quoteNumber,
      quoteCode,
      quoteNo,
      customerDetails,
      // Additional text/meta fields
      termsAndConditions,
      customerNotes,
      notes,
      // Workspace / project metadata (optional)
      projectId,
      projectName,
      workspaceId,
      workspaceName,
      taskId,
      taskName,
      subtaskId,
      subtaskName
    } = req.body;
    const userRole = req.user?.role;

    // Accept quote number from multiple possible field names (Quote# field from form)
    const quoteNumberValue = customQuoteId || quoteNumber || quoteCode || quoteNo || null;

    // Only vendors can create quotations
    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can create quotations'
      });
    }

    if (!vendorId || !customerId || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID, customer ID, and items are required'
      });
    }

    const quotationId = `QT-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const createdAt = new Date().toISOString();

    // Resolve clientId & (canonical) projectId from pm_projects_table based on workspaceId
    const projectContext = await getProjectContextForWorkspace(workspaceId);
    const clientId = projectContext?.clientId || null;
    const resolvedProjectId = projectContext?.projectId || projectId || null;

    // Calculate subtotal from items if not provided
    let calculatedSubtotal = subtotal;
    if (!calculatedSubtotal || calculatedSubtotal === 0) {
      calculatedSubtotal = items.reduce((sum, item) => {
        const itemAmount = parseFloat(item.amount) || 0;
        return sum + itemAmount;
      }, 0);
    }

    // Calculate CGST, SGST, IGST from items if not provided
    let calculatedCgst = cgst;
    let calculatedSgst = sgst;
    let calculatedIgst = igst;

    if ((!calculatedCgst || calculatedCgst === 0) &&
      (!calculatedSgst || calculatedSgst === 0) &&
      (!calculatedIgst || calculatedIgst === 0)) {
      calculatedCgst = items.reduce((sum, item) => {
        const cgstAmount = parseFloat(item.cgstAmount) || 0;
        return sum + cgstAmount;
      }, 0);

      calculatedSgst = items.reduce((sum, item) => {
        const sgstAmount = parseFloat(item.sgstAmount) || 0;
        return sum + sgstAmount;
      }, 0);

      calculatedIgst = items.reduce((sum, item) => {
        const igstAmount = parseFloat(item.igstAmount) || 0;
        return sum + igstAmount;
      }, 0);
    }

    // Calculate total if not provided
    let calculatedTotal = total;
    if (!calculatedTotal || calculatedTotal === 0) {
      calculatedTotal = calculatedSubtotal + calculatedCgst + calculatedSgst + calculatedIgst;
    }

    // NOTE:
    // We no longer generate the final PDF here for workspace quotations.
    // The styled, user-facing PDF is generated on the frontend using html2pdf,
    // uploaded to S3, and then the pdfUrl is patched via updateQuotationPdfUrl.
    // To avoid confusion and double-PDF generation, we leave pdfUrl null at creation time.
    const pdfUrl = null;

    const quotation = {
      quotationId,
      customQuoteId: quoteNumberValue,
      quoteNumber: quoteNumberValue,
      vendorId,
      customerId,
      customerName: customerName || '',
      quotationDate: quotationDate || new Date().toISOString().split('T')[0],
      expiryDate: expiryDate || '',
      billingAddress: billingAddress || {},
      shippingAddress: shippingAddress || {},
      gstin: gstin || '',
      customerDetails: customerDetails || {},
      items: items || [],
      subtotal: calculatedSubtotal,
      cgst: calculatedCgst,
      sgst: calculatedSgst,
      igst: calculatedIgst,
      total: calculatedTotal,
      status: status || 'draft',
      customerNotes: customerNotes || notes || '',
      termsAndConditions: termsAndConditions || '',
      // Workspace / project metadata (all optional)
      projectId: resolvedProjectId,
      projectName: projectName || '',
      workspaceId: workspaceId || null,
      workspaceName: workspaceName || '',
      taskId: taskId || null,
      taskName: taskName || '',
      subtaskId: subtaskId || null,
      subtaskName: subtaskName || '',
      clientId: clientId || null,
      createdAt,
      updatedAt: createdAt,
      pdfUrl // <-- Store S3 PDF URL
    };

    const params = {
      TableName: WORKSPACE_QUOTATIONS_TABLE,
      Item: marshall(quotation, { removeUndefinedValues: true })
    };

    await dbClient.send(new PutItemCommand(params));

    console.log(`✅ Created quotation ${quotationId} for vendor ${vendorId}`);

    res.status(201).json({
      success: true,
      data: quotation,
      message: 'Quotation created successfully'
    });

  } catch (error) {
    console.error('❌ Error creating quotation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create quotation',
      error: error.message
    });
  }
};

/**
 * Update an existing quotation
 * @route PUT /api/workspace/quotations/:quotationId
 * @access Private (Vendor only)
 */
const updateQuotation = async (req, res) => {
  try {
    const { quotationId } = req.params;
    const userRole = req.user?.role;
    const currentVendorId = req.user?.vendorId;

    console.log('📋 UPDATE QUOTATION - Request params:', req.params);
    console.log('📋 UPDATE QUOTATION - Request body keys:', Object.keys(req.body));
    console.log('📋 UPDATE QUOTATION - User:', req.user);
    console.log('📋 UPDATE QUOTATION - Quotation ID from params:', quotationId);
    console.log('📋 UPDATE QUOTATION - Vendor ID:', currentVendorId);
    console.log('📋 UPDATE QUOTATION - Vendor ID type:', typeof currentVendorId);
    console.log('📋 UPDATE QUOTATION - Quotation ID type:', typeof quotationId);

    // Validate required values
    if (!currentVendorId) {
      console.error('❌ Missing vendor ID from user context');
      return res.status(400).json({
        success: false,
        message: 'Missing vendor ID'
      });
    }

    if (!quotationId) {
      console.error('❌ Missing quotation ID from request params');
      return res.status(400).json({
        success: false,
        message: 'Missing quotation ID'
      });
    }

    // Only vendors can update quotations
    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can update quotations'
      });
    }

    // First, get all quotations for this vendor, then find the specific one
    const getParams = {
      TableName: WORKSPACE_QUOTATIONS_TABLE,
      KeyConditionExpression: 'vendorId = :vendorId',
      ExpressionAttributeValues: {
        ':vendorId': { S: currentVendorId }
      }
    };

    console.log('📋 UPDATE QUOTATION - Query params:', JSON.stringify(getParams, null, 2));

    const existingQuotations = await dbClient.send(new QueryCommand(getParams));

    if (!existingQuotations.Items || existingQuotations.Items.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No quotations found for this vendor'
      });
    }

    // Find the specific quotation by quotationId
    const quotations = existingQuotations.Items.map(item => unmarshall(item));
    const targetQuotation = quotations.find(q => q.quotationId === quotationId);

    if (!targetQuotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    const quotationData = targetQuotation;

    // Resolve clientId & (canonical) projectId from pm_projects_table based on (possibly updated) workspaceId
    const effectiveWorkspaceId = req.body.workspaceId || quotationData.workspaceId;
    const projectContext = await getProjectContextForWorkspace(effectiveWorkspaceId);
    const clientId = projectContext?.clientId || quotationData.clientId || null;
    const resolvedProjectId = projectContext?.projectId || req.body.projectId || quotationData.projectId || null;

    // No need to verify vendor ownership since we used vendorId in the composite key lookup

    // Get items from request body or use existing items
    const items = req.body.items || quotationData.items || [];

    // Calculate subtotal from items if not provided or if items changed
    let calculatedSubtotal = req.body.subtotal;
    if (!calculatedSubtotal || calculatedSubtotal === 0 || req.body.items) {
      calculatedSubtotal = items.reduce((sum, item) => {
        const itemAmount = parseFloat(item.amount) || 0;
        return sum + itemAmount;
      }, 0);
    }

    // Calculate CGST, SGST, IGST from items if not provided or if items changed
    let calculatedCgst = req.body.cgst;
    let calculatedSgst = req.body.sgst;
    let calculatedIgst = req.body.igst;

    if (req.body.items ||
      ((!calculatedCgst || calculatedCgst === 0) &&
        (!calculatedSgst || calculatedSgst === 0) &&
        (!calculatedIgst || calculatedIgst === 0))) {
      calculatedCgst = items.reduce((sum, item) => {
        const cgstAmount = parseFloat(item.cgstAmount) || 0;
        return sum + cgstAmount;
      }, 0);

      calculatedSgst = items.reduce((sum, item) => {
        const sgstAmount = parseFloat(item.sgstAmount) || 0;
        return sum + sgstAmount;
      }, 0);

      calculatedIgst = items.reduce((sum, item) => {
        const igstAmount = parseFloat(item.igstAmount) || 0;
        return sum + igstAmount;
      }, 0);
    }

    // Calculate total if not provided or if calculations changed
    let calculatedTotal = req.body.total;
    if (!calculatedTotal || calculatedTotal === 0 || req.body.items ||
      req.body.subtotal !== undefined || req.body.cgst !== undefined ||
      req.body.sgst !== undefined || req.body.igst !== undefined) {
      calculatedTotal = calculatedSubtotal + calculatedCgst + calculatedSgst + calculatedIgst;
    }

    // Handle quote number field (Quote# from form) - accept multiple field names
    const quoteNumberValue = req.body.customQuoteId || req.body.quoteNumber || req.body.quoteCode || req.body.quoteNo || quotationData.customQuoteId || quotationData.quoteNumber || null;

    // Prepare updated quotation data
    const updatedQuotation = {
      ...quotationData, // Keep existing data
      ...req.body, // Override with new data
      quotationId: quotationId, // Ensure quotation ID doesn't change
      vendorId: currentVendorId, // Ensure vendor ID doesn't change
      customQuoteId: quoteNumberValue !== undefined ? quoteNumberValue : (quotationData.customQuoteId || null),
      quoteNumber: quoteNumberValue !== undefined ? quoteNumberValue : (quotationData.quoteNumber || null),
      subtotal: calculatedSubtotal,
      cgst: calculatedCgst,
      sgst: calculatedSgst,
      igst: calculatedIgst,
      total: calculatedTotal,
      projectId: resolvedProjectId,
      clientId: clientId || null,
      updatedAt: new Date().toISOString()
    };

    console.log('📋 UPDATE QUOTATION - Updated quotation data keys:', Object.keys(updatedQuotation));
    console.log('📋 UPDATE QUOTATION - Checking for undefined values...');

    // Check for undefined values
    const undefinedKeys = Object.keys(updatedQuotation).filter(key => updatedQuotation[key] === undefined);
    if (undefinedKeys.length > 0) {
      console.log('⚠️ Found undefined values in keys:', undefinedKeys);
    }

    // Update the quotation in DynamoDB
    const updateParams = {
      TableName: WORKSPACE_QUOTATIONS_TABLE,
      Item: marshall(updatedQuotation, { removeUndefinedValues: true })
    };

    await dbClient.send(new PutItemCommand(updateParams));

    console.log('✅ Quotation updated successfully:', quotationId);

    res.status(200).json({
      success: true,
      data: updatedQuotation,
      message: 'Quotation updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating quotation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update quotation',
      error: error.message
    });
  }
};

/**
 * Get quotations based on user role and permissions
 * @route GET /api/workspace/quotations
 * @access Private
 */
const getQuotations = async (req, res) => {
  try {
    const { vendorId, workspaceId, taskId, subtaskId } = req.query;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    console.log(
      `📋 Fetching quotations - Role: ${userRole}, User ID: ${userId}, Requested Vendor ID: ${vendorId}, workspaceId: ${workspaceId}, taskId: ${taskId}, subtaskId: ${subtaskId}`
    );

    let quotations = [];

    if (userRole === 'pm') {
      // PM can see all quotations from all vendors
      console.log('👑 PM accessing all quotations');

      const params = {
        TableName: WORKSPACE_QUOTATIONS_TABLE
      };

      const command = new ScanCommand(params);
      const { Items } = await dbClient.send(command);

      if (Items && Items.length > 0) {
        quotations = Items.map(item => unmarshall(item));
      }
    } else if (userRole === 'vendor') {
      // Vendor can only see their own quotations
      if (!vendorId || vendorId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Vendors can only access their own quotations'
        });
      }

      console.log(`🔒 Vendor ${vendorId} accessing their quotations with optional workspace/task filters`);

      const params = {
        TableName: WORKSPACE_QUOTATIONS_TABLE,
        KeyConditionExpression: 'vendorId = :vendorId',
        ExpressionAttributeValues: {
          ':vendorId': { S: vendorId }
        }
      };

      // If workspace/task/subtask filters are provided, add them as a FilterExpression
      const filterExpressions = [];
      const expressionAttributeNames = {};

      if (workspaceId) {
        filterExpressions.push('#workspaceId = :workspaceId');
        expressionAttributeNames['#workspaceId'] = 'workspaceId';
        params.ExpressionAttributeValues[':workspaceId'] = { S: workspaceId };
      }

      if (taskId) {
        filterExpressions.push('#taskId = :taskId');
        expressionAttributeNames['#taskId'] = 'taskId';
        params.ExpressionAttributeValues[':taskId'] = { S: taskId };
      }

      if (subtaskId) {
        filterExpressions.push('#subtaskId = :subtaskId');
        expressionAttributeNames['#subtaskId'] = 'subtaskId';
        params.ExpressionAttributeValues[':subtaskId'] = { S: subtaskId };
      }

      if (filterExpressions.length > 0) {
        params.FilterExpression = filterExpressions.join(' AND ');
        params.ExpressionAttributeNames = expressionAttributeNames;
      }

      const command = new QueryCommand(params);
      const { Items } = await dbClient.send(command);

      if (Items && Items.length > 0) {
        quotations = Items.map(item => unmarshall(item));
      }
    } else {
      return res.status(403).json({
        success: false,
        message: 'Invalid user role'
      });
    }

    // Transform data for frontend
    const transformedQuotations = quotations.map(quote => {
      // Calculate CGST and SGST from items if not directly available
      let cgstAmount = 0;
      let cgstRate = 0;
      let sgstAmount = 0;
      let sgstRate = 0;

      if (quote.items && quote.items.length > 0) {
        cgstAmount = quote.items[0]?.cgstAmount || 0;
        cgstRate = quote.items[0]?.cgstRate || 0;
        sgstAmount = quote.items[0]?.sgstAmount || 0;
        sgstRate = quote.items[0]?.sgstRate || 0;
      }
      // Get quote number from multiple possible fields (customQuoteId, quoteNumber, etc.)
      const displayQuoteId = quote.customQuoteId || quote.quoteNumber || quote.quoteCode || quote.quoteNo || quote.quotationId;

      return {
        id: quote.quotationId,
        quotationId: quote.quotationId, // Keep system-generated ID
        customQuoteId: quote.customQuoteId || quote.quoteNumber || null, // Return custom quote ID for display
        quoteNumber: quote.quoteNumber || quote.customQuoteId || null, // Also return as quoteNumber
        displayQuoteId: displayQuoteId, // Use custom ID if available, otherwise use system ID
        date: quote.quoteDate ? new Date(quote.quoteDate).toLocaleDateString('en-GB') :
          quote.createdAt ? new Date(quote.createdAt).toLocaleDateString('en-GB') : 'N/A',
        customer: quote.customerName || 'Unknown Customer',
        cgstAmount,
        cgstRate,
        sgstAmount,
        sgstRate,
        totalAmount: quote.total ? `₹${parseFloat(quote.total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` :
          quote.totalAmount ? `₹${parseFloat(quote.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹0.00',
        status: quote.status ? quote.status.charAt(0).toUpperCase() + quote.status.slice(1) : 'Draft',
        vendorId: quote.vendorId,
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
        items: quote.items || [],
        subTotal: quote.subtotal || quote.subTotal || 0,
        total: quote.total || quote.totalAmount || 0,
        cgst: {
          amount: quote.items?.[0]?.cgstAmount || 0,
          rate: quote.items?.[0]?.cgstRate || 0
        },
        sgst: {
          amount: quote.items?.[0]?.sgstAmount || 0,
          rate: quote.items?.[0]?.sgstRate || 0
        },
        igst: quote.igst || 0,
        totalTax: quote.totalTax,
        customerNotes: quote.customerNotes,
        termsAndConditions: quote.termsAndConditions,
        // Workspace / project metadata for frontend
        projectName: quote.projectName,
        projectId: quote.projectId,
        workspaceId: quote.workspaceId,
        workspaceName: quote.workspaceName,
        taskId: quote.taskId,
        taskName: quote.taskName,
        subtaskId: quote.subtaskId,
        subtaskName: quote.subtaskName,
        expiryDate: quote.expiryDate,
        customerDetails: quote.customerDetails,
        pdfUrl: quote.pdfUrl || null,  // Include pdfUrl in the response
        clientId: quote.clientId || null
      };
    });

    console.log(`✅ Found ${transformedQuotations.length} quotations`);

    res.status(200).json({
      success: true,
      data: transformedQuotations,
      count: transformedQuotations.length,
      message: `Successfully fetched ${transformedQuotations.length} quotations`
    });

  } catch (error) {
    console.error('❌ Error fetching quotations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quotations',
      error: error.message
    });
  }
};

/**
 * Get quotation statistics based on user role
 * @route GET /api/workspace/quotations/stats
 * @access Private
 */
const getQuotationsStats = async (req, res) => {
  try {
    const { vendorId } = req.query;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    console.log(`📊 Fetching quotation stats - Role: ${userRole}, User ID: ${userId}`);

    let quotations = [];

    if (userRole === 'pm') {
      // PM gets stats for all quotations
      const params = {
        TableName: WORKSPACE_QUOTATIONS_TABLE
      };
      const command = new ScanCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        quotations = Items.map(item => unmarshall(item));
      }
    } else if (userRole === 'vendor') {
      // Vendor gets stats only for their quotations
      if (!vendorId || vendorId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Vendors can only access their own statistics'
        });
      }

      const params = {
        TableName: WORKSPACE_QUOTATIONS_TABLE,
        KeyConditionExpression: 'vendorId = :vendorId',
        ExpressionAttributeValues: {
          ':vendorId': { S: vendorId }
        }
      };
      const command = new QueryCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        quotations = Items.map(item => unmarshall(item));
      }
    }

    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    const stats = {
      totalQuotes: quotations.length,
      totalValue: quotations.reduce((sum, quote) => sum + (parseFloat(quote.totalAmount) || 0), 0),
      approvedQuotes: quotations.filter(quote => quote.status === 'approved').length,
      draftQuotes: quotations.filter(quote => quote.status === 'draft').length,
      pendingQuotes: quotations.filter(quote => quote.status === 'pending').length,
      thisMonthQuotes: quotations.filter(quote => {
        const quoteDate = new Date(quote.createdAt || quote.updatedAt);
        return quoteDate.getMonth() === thisMonth && quoteDate.getFullYear() === thisYear;
      }).length,
      thisMonthValue: quotations.filter(quote => {
        const quoteDate = new Date(quote.createdAt || quote.updatedAt);
        return quoteDate.getMonth() === thisMonth && quoteDate.getFullYear() === thisYear;
      }).reduce((sum, quote) => sum + (parseFloat(quote.totalAmount) || 0), 0)
    };

    res.status(200).json({
      success: true,
      data: stats,
      message: 'Quotation statistics fetched successfully'
    });

  } catch (error) {
    console.error('❌ Error fetching quotation stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quotation statistics',
      error: error.message
    });
  }
};

/**
 * Update quotation status (PM approval)
 * @route PUT /api/workspace/quotations/:quotationId/status
 * @access Private (PM only)
 */
const updateQuotationStatus = async (req, res) => {
  try {
    const { quotationId } = req.params;
    const { status, pmFeedback } = req.body;
    const userRole = req.user?.role;
    const pmId = req.user?.id;

    // Only PMs can update quotation status
    if (userRole !== 'pm') {
      return res.status(403).json({
        success: false,
        message: 'Only PMs can update quotation status'
      });
    }

    if (!quotationId || !status) {
      return res.status(400).json({
        success: false,
        message: 'Quotation ID and status are required'
      });
    }

    // First get the quotation to check if it exists
    const getParams = {
      TableName: WORKSPACE_QUOTATIONS_TABLE,
      Key: marshall({
        quotationId,
        vendorId: req.body.vendorId // We need vendorId to get the item
      })
    };

    const getResult = await dbClient.send(new GetItemCommand(getParams));

    if (!getResult.Item) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    // Update the quotation status
    const updateParams = {
      TableName: WORKSPACE_QUOTATIONS_TABLE,
      Key: marshall({
        quotationId,
        vendorId: req.body.vendorId
      }),
      UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #pmApproval = :pmApproval',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        '#pmApproval': 'pmApproval'
      },
      ExpressionAttributeValues: marshall({
        ':status': status,
        ':updatedAt': new Date().toISOString(),
        ':pmApproval': {
          pmId,
          status,
          feedback: pmFeedback || '',
          approvedAt: new Date().toISOString()
        }
      }),
      ReturnValues: 'ALL_NEW'
    };

    const result = await dbClient.send(new UpdateItemCommand(updateParams));
    const updatedQuotation = unmarshall(result.Attributes);

    console.log(`✅ Updated quotation ${quotationId} status to ${status} by PM ${pmId}`);

    res.status(200).json({
      success: true,
      data: updatedQuotation,
      message: 'Quotation status updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating quotation status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update quotation status',
      error: error.message
    });
  }
};

/**
 * Send quotation to PM for review (Vendor action)
 * @route PUT /api/workspace/quotations/:quotationId/send-to-pm
 * @access Private (Vendor only)
 */
const sendQuotationToPM = async (req, res) => {
  try {
    const { quotationId } = req.params;
    const { vendorId } = req.body;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    // Only vendors can send quotations to PM
    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can send quotations to PM'
      });
    }

    // Verify the vendor owns this quotation
    if (vendorId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only send your own quotations to PM'
      });
    }

    if (!quotationId || !vendorId) {
      return res.status(400).json({
        success: false,
        message: 'Quotation ID and vendor ID are required'
      });
    }

    // First get the quotation to check if it exists and get all details
    const getParams = {
      TableName: WORKSPACE_QUOTATIONS_TABLE,
      Key: marshall({
        quotationId,
        vendorId
      })
    };

    const getResult = await dbClient.send(new GetItemCommand(getParams));

    if (!getResult.Item) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    const quotationData = unmarshall(getResult.Item);
    const sentToPmAt = new Date().toISOString();

    // Resolve clientId & (canonical) projectId from pm_projects_table based on workspaceId
    const projectContext = await getProjectContextForWorkspace(quotationData.workspaceId);
    const clientId = projectContext?.clientId || null;
    const resolvedProjectId = projectContext?.projectId || quotationData.projectId || null;

    // Update the quotation status in workspace_quotations table
    const updateParams = {
      TableName: WORKSPACE_QUOTATIONS_TABLE,
      Key: marshall({
        quotationId,
        vendorId
      }),
      UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #sentToPmAt = :sentToPmAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        '#sentToPmAt': 'sentToPmAt'
      },
      ExpressionAttributeValues: marshall({
        ':status': 'sent to pm for review',
        ':updatedAt': sentToPmAt,
        ':sentToPmAt': sentToPmAt
      }),
      ReturnValues: 'ALL_NEW'
    };

    const result = await dbClient.send(new UpdateItemCommand(updateParams));
    const updatedQuotation = unmarshall(result.Attributes);

    // Store complete quotation details in vendor_quotes_to_pm table
    const quoteToPM = {
      vendorId,
      quotationId,
      customQuoteId: quotationData.customQuoteId || quotationData.quoteNumber || null,
      customerName: quotationData.customerName || 'Unknown Customer',
      customerDetails: quotationData.customerDetails || {},
      quotationDate: quotationData.quotationDate || quotationData.createdAt,
      expiryDate: quotationData.expiryDate || null,
      billingAddress: quotationData.billingAddress || {},
      shippingAddress: quotationData.shippingAddress || {},
      gstin: quotationData.gstin || '',
      items: quotationData.items || [],
      subtotal: quotationData.subtotal || 0,
      cgst: quotationData.cgst || 0,
      sgst: quotationData.sgst || 0,
      igst: quotationData.igst || 0,
      totalCgst: quotationData.totalCgst || quotationData.cgst || 0,
      totalSgst: quotationData.totalSgst || quotationData.sgst || 0,
      totalIgst: quotationData.totalIgst || quotationData.igst || 0,
      totalTax: quotationData.totalTax || 0,
      discount: quotationData.discount || 0,
      total: quotationData.total || 0,
      customerNotes: quotationData.customerNotes || '',
      termsAndConditions: quotationData.termsAndConditions || '',
      status: 'sent to pm for review',
      // Workspace / project metadata (preserved for PM views)
      projectId: resolvedProjectId,
      projectName: quotationData.projectName || '',
      workspaceId: quotationData.workspaceId || null,
      workspaceName: quotationData.workspaceName || '',
      taskId: quotationData.taskId || null,
      taskName: quotationData.taskName || '',
      subtaskId: quotationData.subtaskId || null,
      subtaskName: quotationData.subtaskName || '',
      sentToPmAt,
      pmReviewedAt: null,
      pmFeedback: null,
      pmId: null,
      clientId: clientId || null,
      pdfUrl: quotationData.pdfUrl || null,
      createdAt: quotationData.createdAt,
      updatedAt: sentToPmAt
    };

    const putParams = {
      TableName: 'vendor_quotes_to_pm',
      Item: marshall(quoteToPM, { removeUndefinedValues: true })
    };

    await dbClient.send(new PutItemCommand(putParams));

    console.log(`✅ Quotation ${quotationId} sent to PM for review by vendor ${vendorId}`);
    console.log(`✅ Complete quotation details stored in vendor_quotes_to_pm table`);

    res.status(200).json({
      success: true,
      data: updatedQuotation,
      message: 'Quotation sent to PM for review successfully'
    });

  } catch (error) {
    console.error('❌ Error sending quotation to PM:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send quotation to PM',
      error: error.message
    });
  }
};

/**
 * ========================================
 * INVOICES MANAGEMENT
 * ========================================
 */

/**
 * Create a new invoice for a vendor
 * @route POST /api/workspace/invoices
 * @access Private (Vendor only)
 */
const createInvoice = async (req, res) => {
  try {
    console.log('📋 CREATE INVOICE - Request body:', req.body);
    console.log('📋 CREATE INVOICE - User:', req.user);

    const {
      vendorId,
      customerId,
      customerName,
      invoiceDate,
      dueDate,
      billingAddress,
      shippingAddress,
      gstin,
      items,
      subtotal,
      cgst,
      sgst,
      igst,
      total,
      status,
      customInvoiceId,
      invoiceNumber,
      invoiceCode,
      invoiceNo,
      customerDetails,
      quoteId
    } = req.body;
    const userRole = req.user?.role;

    // Accept invoice number from multiple possible field names
    const invoiceNumberValue = customInvoiceId || invoiceNumber || invoiceCode || invoiceNo || null;

    // Only vendors can create invoices
    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can create invoices'
      });
    }

    if (!vendorId) {
      console.error('❌ Missing vendorId');
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required'
      });
    }

    if (!customerId) {
      console.error('❌ Missing customerId');
      return res.status(400).json({
        success: false,
        message: 'Customer ID is required'
      });
    }

    if (!items || items.length === 0) {
      console.error('❌ Missing items or empty items array');
      return res.status(400).json({
        success: false,
        message: 'At least one item is required'
      });
    }

    const invoiceId = `INV-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const createdAt = new Date().toISOString();

    // Calculate subtotal from items if not provided
    let calculatedSubtotal = subtotal;
    if (!calculatedSubtotal || calculatedSubtotal === 0) {
      calculatedSubtotal = items.reduce((sum, item) => {
        const itemAmount = parseFloat(item.amount) || 0;
        return sum + itemAmount;
      }, 0);
    }

    // Calculate CGST, SGST, IGST from items if not provided
    let calculatedCgst = cgst;
    let calculatedSgst = sgst;
    let calculatedIgst = igst;

    if ((!calculatedCgst || calculatedCgst === 0) &&
      (!calculatedSgst || calculatedSgst === 0) &&
      (!calculatedIgst || calculatedIgst === 0)) {
      calculatedCgst = items.reduce((sum, item) => {
        const cgstAmount = parseFloat(item.cgstAmount) || 0;
        return sum + cgstAmount;
      }, 0);

      calculatedSgst = items.reduce((sum, item) => {
        const sgstAmount = parseFloat(item.sgstAmount) || 0;
        return sum + sgstAmount;
      }, 0);

      calculatedIgst = items.reduce((sum, item) => {
        const igstAmount = parseFloat(item.igstAmount) || 0;
        return sum + igstAmount;
      }, 0);
    }

    // Calculate total if not provided
    let calculatedTotal = total;
    if (!calculatedTotal || calculatedTotal === 0) {
      calculatedTotal = calculatedSubtotal + calculatedCgst + calculatedSgst + calculatedIgst;
    }

    const invoice = {
      invoiceId,
      customInvoiceId: invoiceNumberValue, // Store custom invoice ID for display
      invoiceNumber: invoiceNumberValue, // Also store as invoiceNumber for compatibility
      vendorId,
      customerId,
      customerName: customerName || '',
      invoiceDate: invoiceDate || new Date().toISOString().split('T')[0],
      dueDate: dueDate || '',
      billingAddress: billingAddress || {},
      shippingAddress: shippingAddress || {},
      gstin: gstin || '',
      customerDetails: customerDetails || {}, // Store full customer details for display
      items: items || [],
      subtotal: calculatedSubtotal,
      cgst: calculatedCgst,
      sgst: calculatedSgst,
      igst: calculatedIgst,
      total: calculatedTotal,
      status: status || 'draft',
      quoteId: quoteId || null, // Reference to original quote if converted from quote
      createdAt,
      updatedAt: createdAt
    };

    const params = {
      TableName: WORKSPACE_INVOICES_TABLE,
      Item: marshall(invoice, { removeUndefinedValues: true })
    };

    await dbClient.send(new PutItemCommand(params));

    console.log(`✅ Created invoice ${invoiceId} for vendor ${vendorId}`);

    res.status(201).json({
      success: true,
      data: invoice,
      message: 'Invoice created successfully'
    });

  } catch (error) {
    console.error('❌ Error creating invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create invoice',
      error: error.message
    });
  }
};

/**
 * Create a new purchase order for a vendor from a quotation
 * @route POST /api/workspace/purchase-orders
 * @access Private (Vendor only)
 */
const createPurchaseOrderFromQuote = async (req, res) => {
  try {
    console.log('📋 CREATE PURCHASE ORDER - Request body:', req.body);
    console.log('📋 CREATE PURCHASE ORDER - User:', req.user);

    const {
      vendorId,
      quotationId,
      customPoId,
      referenceQuoteNumber,
      customerId,
      customerName,
      customerDetails,
      items,
      subtotal,
      totalCgst,
      totalSgst,
      totalIgst,
      total,
      status,
      workspaceId,
      workspaceName,
      projectId,
      projectName,
      taskId,
      taskName,
      subtaskId,
      subtaskName,
      clientId: clientIdFromBody,
      pdfUrl
    } = req.body;

    const userRole = req.user?.role;
    const currentVendorId = req.user?.vendorId;

    // Only vendors can create purchase orders
    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can create purchase orders'
      });
    }

    if (!vendorId || !quotationId || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID, quotation ID, and items are required'
      });
    }

    if (currentVendorId && vendorId !== currentVendorId) {
      return res.status(403).json({
        success: false,
        message: 'Vendors can only create purchase orders for themselves'
      });
    }

    const purchaseOrderId = `PO-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const createdAt = new Date().toISOString();

    // Resolve clientId & (canonical) projectId from pm_projects_table based on workspaceId
    const projectContext = await getProjectContextForWorkspace(workspaceId);
    const clientId = clientIdFromBody || projectContext?.clientId || null;
    const resolvedProjectId = projectContext?.projectId || projectId || null;

    // Calculate subtotal from items if not provided
    let calculatedSubtotal = subtotal;
    if (!calculatedSubtotal || calculatedSubtotal === 0) {
      calculatedSubtotal = items.reduce((sum, item) => {
        const itemAmount = parseFloat(item.amount) || 0;
        return sum + itemAmount;
      }, 0);
    }

    // Calculate CGST, SGST, IGST from items if not provided
    let calculatedCgst = totalCgst;
    let calculatedSgst = totalSgst;
    let calculatedIgst = totalIgst;

    if (
      (!calculatedCgst || calculatedCgst === 0) &&
      (!calculatedSgst || calculatedSgst === 0) &&
      (!calculatedIgst || calculatedIgst === 0)
    ) {
      calculatedCgst = items.reduce((sum, item) => {
        const cgstAmount = parseFloat(item.cgstAmount) || 0;
        return sum + cgstAmount;
      }, 0);

      calculatedSgst = items.reduce((sum, item) => {
        const sgstAmount = parseFloat(item.sgstAmount) || 0;
        return sum + sgstAmount;
      }, 0);

      calculatedIgst = items.reduce((sum, item) => {
        const igstAmount = parseFloat(item.igstAmount) || 0;
        return sum + igstAmount;
      }, 0);
    }

    // Calculate total if not provided
    let calculatedTotal = total;
    if (!calculatedTotal || calculatedTotal === 0) {
      calculatedTotal = calculatedSubtotal + calculatedCgst + calculatedSgst + calculatedIgst;
    }

    const purchaseOrder = {
      purchaseOrderId,
      purchaseOrderNumber: customPoId || quotationId,
      customPoId: customPoId || null,
      referenceQuoteNumber: referenceQuoteNumber || null,
      vendorId,
      clientId: clientId || null,
      customerId: customerId || null,
      customerName: customerName || '',
      customerDetails: customerDetails || {},
      quotationId,
      purchaseOrderDate: createdAt.split('T')[0],
      items: items || [],
      subtotal: calculatedSubtotal,
      cgst: calculatedCgst,
      sgst: calculatedSgst,
      igst: calculatedIgst,
      total: calculatedTotal,
      status: status || 'sent to pm',
      statusType: 'pending',
      workspaceId: workspaceId || null,
      workspaceName: workspaceName || '',
      projectId: resolvedProjectId,
      projectName: projectName || '',
      taskId: taskId || null,
      taskName: taskName || '',
      subtaskId: subtaskId || null,
      subtaskName: subtaskName || '',
      pdfUrl: pdfUrl || null,
      createdAt,
      updatedAt: createdAt
    };

    const params = {
      TableName: WORKSPACE_PURCHASE_ORDERS_TABLE,
      Item: marshall(purchaseOrder, { removeUndefinedValues: true })
    };

    await dbClient.send(new PutItemCommand(params));

    // After creating the purchase order, update the related quotation status
    // so it reflects that a PO has been raised and sent to PM for review.
    if (vendorId && quotationId) {
      try {
        const updateQuoteStatusParams = {
          TableName: WORKSPACE_QUOTATIONS_TABLE,
          Key: marshall({
            vendorId,
            quotationId
          }),
          UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#updatedAt': 'updatedAt'
          },
          ExpressionAttributeValues: marshall({
            ':status': 'po sent to pm for review',
            ':updatedAt': new Date().toISOString()
          })
        };

        await dbClient.send(new UpdateItemCommand(updateQuoteStatusParams));
        console.log(
          `✅ Updated quotation ${quotationId} status to 'po sent to pm for review' after creating purchase order`
        );
      } catch (statusError) {
        console.error(
          '⚠️ Failed to update quotation status after creating purchase order:',
          statusError
        );
        // Do not fail the PO creation response if the status update fails
      }
    }

    console.log(
      `✅ Created purchase order ${purchaseOrderId} for vendor ${vendorId} from quotation ${quotationId}`
    );

    res.status(201).json({
      success: true,
      data: purchaseOrder,
      message: 'Purchase order created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating purchase order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create purchase order',
      error: error.message
    });
  }
};

/**
 * ========================================
 * CREDIT NOTES MANAGEMENT
 * ========================================
 */

/**
 * Create a new credit note for a vendor
 * @route POST /api/workspace/credit-notes
 * @access Private (Vendor only)
 */
const createCreditNote = async (req, res) => {
  try {
    console.log('📋 CREATE CREDIT NOTE - Request body:', req.body);
    console.log('📋 CREATE CREDIT NOTE - User:', req.user);

    const {
      vendorId,
      customerId,
      customerName,
      creditNoteDate,
      billingAddress,
      shippingAddress,
      gstin,
      items,
      subtotal,
      cgst,
      sgst,
      igst,
      total,
      status,
      customCreditNoteId,
      creditNoteNumber,
      creditNoteCode,
      creditNoteNo,
      customerDetails,
      invoiceId
    } = req.body;
    const userRole = req.user?.role;

    // Accept credit note number from multiple possible field names
    const creditNoteNumberValue = customCreditNoteId || creditNoteNumber || creditNoteCode || creditNoteNo || null;

    // Only vendors can create credit notes
    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can create credit notes'
      });
    }

    if (!vendorId) {
      console.error('❌ Missing vendorId');
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required'
      });
    }

    if (!customerId) {
      console.error('❌ Missing customerId');
      return res.status(400).json({
        success: false,
        message: 'Customer ID is required'
      });
    }

    if (!items || items.length === 0) {
      console.error('❌ Missing items or empty items array');
      return res.status(400).json({
        success: false,
        message: 'At least one item is required'
      });
    }

    const creditNoteId = `CN-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const createdAt = new Date().toISOString();

    // Calculate subtotal from items if not provided
    let calculatedSubtotal = subtotal;
    if (!calculatedSubtotal || calculatedSubtotal === 0) {
      calculatedSubtotal = items.reduce((sum, item) => {
        const itemAmount = parseFloat(item.amount) || 0;
        return sum + itemAmount;
      }, 0);
    }

    // Calculate CGST, SGST, IGST from items if not provided
    let calculatedCgst = cgst;
    let calculatedSgst = sgst;
    let calculatedIgst = igst;

    if ((!calculatedCgst || calculatedCgst === 0) &&
      (!calculatedSgst || calculatedSgst === 0) &&
      (!calculatedIgst || calculatedIgst === 0)) {
      calculatedCgst = items.reduce((sum, item) => {
        const cgstAmount = parseFloat(item.cgstAmount) || 0;
        return sum + cgstAmount;
      }, 0);

      calculatedSgst = items.reduce((sum, item) => {
        const sgstAmount = parseFloat(item.sgstAmount) || 0;
        return sum + sgstAmount;
      }, 0);

      calculatedIgst = items.reduce((sum, item) => {
        const igstAmount = parseFloat(item.igstAmount) || 0;
        return sum + igstAmount;
      }, 0);
    }

    // Calculate total if not provided
    let calculatedTotal = total;
    if (!calculatedTotal || calculatedTotal === 0) {
      calculatedTotal = calculatedSubtotal + calculatedCgst + calculatedSgst + calculatedIgst;
    }

    const creditNote = {
      creditNoteId,
      customCreditNoteId: creditNoteNumberValue, // Store custom credit note ID for display
      creditNoteNumber: creditNoteNumberValue, // Also store as creditNoteNumber for compatibility
      vendorId,
      customerId,
      customerName: customerName || '',
      creditNoteDate: creditNoteDate || new Date().toISOString().split('T')[0],
      billingAddress: billingAddress || {},
      shippingAddress: shippingAddress || {},
      gstin: gstin || '',
      customerDetails: customerDetails || {}, // Store full customer details for display
      items: items || [],
      subtotal: calculatedSubtotal,
      cgst: calculatedCgst,
      sgst: calculatedSgst,
      igst: calculatedIgst,
      total: calculatedTotal,
      status: status || 'draft',
      invoiceId: invoiceId || null, // Reference to original invoice
      createdAt,
      updatedAt: createdAt
    };

    const params = {
      TableName: WORKSPACE_CREDIT_NOTES_TABLE,
      Item: marshall(creditNote, { removeUndefinedValues: true })
    };

    await dbClient.send(new PutItemCommand(params));

    console.log(`✅ Created credit note ${creditNoteId} for vendor ${vendorId}`);

    res.status(201).json({
      success: true,
      data: creditNote,
      message: 'Credit note created successfully'
    });

  } catch (error) {
    console.error('❌ Error creating credit note:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create credit note',
      error: error.message
    });
  }
};

/**
 * Get invoices based on user role and permissions
 * @route GET /api/workspace/invoices
 * @access Private
 */
const getInvoices = async (req, res) => {
  try {
    const { vendorId, workspaceId, taskId, subtaskId } = req.query;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    console.log(
      `📋 Fetching invoices - Role: ${userRole}, User ID: ${userId}, Requested Vendor ID: ${vendorId}, workspaceId: ${workspaceId}, taskId: ${taskId}, subtaskId: ${subtaskId}`
    );

    let invoices = [];

    if (userRole === 'pm') {
      // PM can see all invoices from all vendors
      const params = {
        TableName: WORKSPACE_INVOICES_TABLE
      };
      const command = new ScanCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        invoices = Items.map(item => unmarshall(item));
      }
    } else if (userRole === 'vendor') {
      // Vendor can only see their own invoices
      if (!vendorId || vendorId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Vendors can only access their own invoices'
        });
      }

      const params = {
        TableName: WORKSPACE_INVOICES_TABLE,
        KeyConditionExpression: 'vendorId = :vendorId',
        ExpressionAttributeValues: {
          ':vendorId': { S: vendorId }
        }
      };

      // If workspace/task/subtask filters are provided, add them as a FilterExpression
      const filterExpressions = [];
      const expressionAttributeNames = {};

      if (workspaceId) {
        filterExpressions.push('#workspaceId = :workspaceId');
        expressionAttributeNames['#workspaceId'] = 'workspaceId';
        params.ExpressionAttributeValues[':workspaceId'] = { S: workspaceId };
      }

      if (taskId) {
        filterExpressions.push('#taskId = :taskId');
        expressionAttributeNames['#taskId'] = 'taskId';
        params.ExpressionAttributeValues[':taskId'] = { S: taskId };
      }

      if (subtaskId) {
        filterExpressions.push('#subtaskId = :subtaskId');
        expressionAttributeNames['#subtaskId'] = 'subtaskId';
        params.ExpressionAttributeValues[':subtaskId'] = { S: subtaskId };
      }

      if (filterExpressions.length > 0) {
        params.FilterExpression = filterExpressions.join(' AND ');
        params.ExpressionAttributeNames = expressionAttributeNames;
      }

      const command = new QueryCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        invoices = Items.map(item => unmarshall(item));
      }
    }

    // Transform data for frontend
    const transformedInvoices = invoices.map(invoice => ({
      id: invoice.invoiceId,
      date: invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString('en-GB') :
        invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString('en-GB') : 'N/A',
      customer: invoice.customerName || 'Unknown Customer',
      totalAmount: invoice.totalAmount ? `₹${parseFloat(invoice.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹0.00',
      status: invoice.status ? invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1) : 'Draft',
      vendorId: invoice.vendorId,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
      items: invoice.items || [],
      subTotal: invoice.subTotal,
      totalTax: invoice.totalTax,
      paymentStatus: invoice.paymentStatus || 'pending',
      dueDate: invoice.dueDate
    }));

    res.status(200).json({
      success: true,
      data: transformedInvoices,
      count: transformedInvoices.length,
      message: `Successfully fetched ${transformedInvoices.length} invoices`
    });

  } catch (error) {
    console.error('❌ Error fetching invoices:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices',
      error: error.message
    });
  }
};

/**
 * ========================================
 * CUSTOMERS MANAGEMENT
 * ========================================
 */

/**
 * Create a new customer for a vendor
 * @route POST /api/workspace/customers
 * @access Private (Vendor only)
 */
const createCustomer = async (req, res) => {
  try {
    const { vendorId, customerData } = req.body;
    const userRole = req.user?.role;

    // Only vendors can create customers
    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can create customers'
      });
    }

    if (!vendorId || !customerData) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID and customer data are required'
      });
    }

    const customerId = uuidv4();
    const createdAt = new Date().toISOString();

    const customer = {
      customerId,
      vendorId,
      ...customerData,
      status: customerData.status || 'active',
      createdAt,
      updatedAt: createdAt
    };

    const params = {
      TableName: WORKSPACE_CUSTOMERS_TABLE,
      Item: marshall(customer)
    };

    await dbClient.send(new PutItemCommand(params));

    console.log(`✅ Created customer ${customerId} for vendor ${vendorId}`);

    res.status(201).json({
      success: true,
      data: customer,
      message: 'Customer created successfully'
    });

  } catch (error) {
    console.error('❌ Error creating customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create customer',
      error: error.message
    });
  }
};

/**
 * Get customers based on user role and permissions
 * @route GET /api/workspace/customers
 * @access Private
 */
const getCustomers = async (req, res) => {
  try {
    const { vendorId } = req.query;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    console.log(`📋 Fetching customers - Role: ${userRole}, User ID: ${userId}`);

    let customers = [];

    if (userRole === 'pm') {
      // PM can see all customers from all vendors
      const params = {
        TableName: WORKSPACE_CUSTOMERS_TABLE
      };
      const command = new ScanCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        customers = Items.map(item => unmarshall(item));
      }
    } else if (userRole === 'vendor') {
      // Vendor can only see their own customers
      if (!vendorId || vendorId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Vendors can only access their own customers'
        });
      }

      const params = {
        TableName: WORKSPACE_CUSTOMERS_TABLE,
        KeyConditionExpression: 'vendorId = :vendorId',
        ExpressionAttributeValues: {
          ':vendorId': { S: vendorId }
        }
      };
      const command = new QueryCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        customers = Items.map(item => unmarshall(item));
      }
    }

    // Transform data for frontend
    const transformedCustomers = customers.map(customer => ({
      id: customer.customerId,
      name: customer.name || customer.companyName || 'Unknown',
      companyName: customer.companyName || customer.name || 'Unknown',
      email: customer.email || '-',
      workPhone: customer.phone || customer.workPhone || '-',
      receivables: customer.receivables || '₹0.00',
      unusedCredits: customer.unusedCredits || '₹0.00',
      status: customer.status || 'Active',
      vendorId: customer.vendorId,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: transformedCustomers,
      count: transformedCustomers.length,
      message: `Successfully fetched ${transformedCustomers.length} customers`
    });

  } catch (error) {
    console.error('❌ Error fetching customers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customers',
      error: error.message
    });
  }
};

/**
 * Get customer by ID
 * @route GET /api/workspace/customers/:customerId
 * @access Private
 */
const getCustomerById = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { vendorId } = req.query;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID is required'
      });
    }

    let customer = null;

    if (userRole === 'pm') {
      // PM can get any customer
      const params = {
        TableName: WORKSPACE_CUSTOMERS_TABLE,
        FilterExpression: 'customerId = :customerId',
        ExpressionAttributeValues: {
          ':customerId': { S: customerId }
        }
      };
      const command = new ScanCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items && Items.length > 0) {
        customer = unmarshall(Items[0]);
      }
    } else if (userRole === 'vendor') {
      // Vendor can only get their own customers
      if (!vendorId || vendorId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Vendors can only access their own customers'
        });
      }

      const params = {
        TableName: WORKSPACE_CUSTOMERS_TABLE,
        Key: marshall({
          vendorId: vendorId,
          customerId: customerId
        })
      };
      const command = new GetItemCommand(params);
      const { Item } = await dbClient.send(command);
      if (Item) {
        customer = unmarshall(Item);
      }
    }

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    res.status(200).json({
      success: true,
      data: customer,
      message: 'Customer details fetched successfully'
    });

  } catch (error) {
    console.error('❌ Error fetching customer details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer details',
      error: error.message
    });
  }
};

/**
 * Update customer
 * @route PUT /api/workspace/customers/:customerId
 * @access Private
 */
const updateCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { vendorId, updates } = req.body;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    if (!customerId || !vendorId || !updates) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID, vendor ID, and updates are required'
      });
    }

    // Only vendors can update their own customers
    if (userRole !== 'vendor' || vendorId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Vendors can only update their own customers'
      });
    }

    // First get the existing customer
    const getParams = {
      TableName: WORKSPACE_CUSTOMERS_TABLE,
      Key: marshall({
        vendorId: vendorId,
        customerId: customerId
      })
    };
    const getCommand = new GetItemCommand(getParams);
    const { Item } = await dbClient.send(getCommand);

    if (!Item) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const existingCustomer = unmarshall(Item);
    const updatedAt = new Date().toISOString();

    // Merge updates with existing data
    const updatedCustomer = {
      ...existingCustomer,
      ...updates,
      updatedAt
    };

    // Update the customer
    const updateParams = {
      TableName: WORKSPACE_CUSTOMERS_TABLE,
      Item: marshall(updatedCustomer)
    };
    await dbClient.send(new PutItemCommand(updateParams));

    console.log(`✅ Updated customer ${customerId} for vendor ${vendorId}`);

    res.status(200).json({
      success: true,
      data: updatedCustomer,
      message: 'Customer updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update customer',
      error: error.message
    });
  }
};

/**
 * Search customers
 * @route GET /api/workspace/customers/search
 * @access Private
 */
const searchCustomers = async (req, res) => {
  try {
    const { query, vendorId } = req.query;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    let customers = [];

    if (userRole === 'pm') {
      // PM can search all customers
      const params = {
        TableName: WORKSPACE_CUSTOMERS_TABLE,
        FilterExpression: 'contains(#name, :query) OR contains(#companyName, :query) OR contains(#email, :query)',
        ExpressionAttributeNames: {
          '#name': 'name',
          '#companyName': 'companyName',
          '#email': 'email'
        },
        ExpressionAttributeValues: {
          ':query': query
        }
      };
      const command = new ScanCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        customers = Items.map(item => unmarshall(item));
      }
    } else if (userRole === 'vendor') {
      // Vendor can only search their own customers
      if (!vendorId || vendorId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Vendors can only search their own customers'
        });
      }

      const params = {
        TableName: WORKSPACE_CUSTOMERS_TABLE,
        KeyConditionExpression: 'vendorId = :vendorId',
        FilterExpression: 'contains(#name, :query) OR contains(#companyName, :query) OR contains(#email, :query)',
        ExpressionAttributeNames: {
          '#name': 'name',
          '#companyName': 'companyName',
          '#email': 'email'
        },
        ExpressionAttributeValues: {
          ':vendorId': { S: vendorId },
          ':query': query
        }
      };
      const command = new QueryCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        customers = Items.map(item => unmarshall(item));
      }
    }

    // Transform data for frontend
    const transformedCustomers = customers.map(customer => ({
      id: customer.customerId,
      name: customer.name || customer.companyName || 'Unknown',
      companyName: customer.companyName || customer.name || 'Unknown',
      email: customer.email || '-',
      workPhone: customer.phone || customer.workPhone || '-',
      receivables: customer.receivables || '₹0.00',
      unusedCredits: customer.unusedCredits || '₹0.00',
      status: customer.status || 'Active'
    }));

    res.status(200).json({
      success: true,
      data: transformedCustomers,
      count: transformedCustomers.length,
      message: `Found ${transformedCustomers.length} customers matching "${query}"`
    });

  } catch (error) {
    console.error('❌ Error searching customers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search customers',
      error: error.message
    });
  }
};

/**
 * ========================================
 * ITEMS MANAGEMENT
 * ========================================
 */

/**
 * Create a new item for a vendor
 * @route POST /api/workspace/items
 * @access Private (Vendor only)
 */
const createItem = async (req, res) => {
  try {
    console.log('📦 CREATE ITEM - Request body:', req.body);
    console.log('📦 CREATE ITEM - User:', req.user);

    const { vendorId, name, description, type, unit, rate, hsn, sac, gst, status } = req.body;
    const userRole = req.user?.role;

    // Only vendors can create items
    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can create items'
      });
    }

    if (!vendorId || !name || !rate) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID, name, and rate are required'
      });
    }

    const itemId = uuidv4();
    const createdAt = new Date().toISOString();

    const item = {
      itemId,
      vendorId,
      name,
      description: description || '',
      type: type || 'Product',
      unit: unit || 'Nos',
      rate: parseFloat(rate),
      hsn: hsn || null,
      sac: sac || null,
      gst: gst || 18,
      status: status || 'Active',
      createdAt,
      updatedAt: createdAt
    };

    const params = {
      TableName: WORKSPACE_ITEMS_TABLE,
      Item: marshall(item)
    };

    await dbClient.send(new PutItemCommand(params));

    console.log(`✅ Created item ${itemId} for vendor ${vendorId}`);

    res.status(201).json({
      success: true,
      data: item,
      message: 'Item created successfully'
    });

  } catch (error) {
    console.error('❌ Error creating item:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create item',
      error: error.message
    });
  }
};

/**
 * Get items based on user role and permissions
 * @route GET /api/workspace/items
 * @access Private
 */
const getItems = async (req, res) => {
  try {
    const { vendorId } = req.query;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    console.log(`📋 Fetching items - Role: ${userRole}, User ID: ${userId}`);

    let items = [];

    if (userRole === 'pm') {
      // PM can see all items from all vendors
      const params = {
        TableName: WORKSPACE_ITEMS_TABLE
      };
      const command = new ScanCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        items = Items.map(item => unmarshall(item));
      }
    } else if (userRole === 'vendor') {
      // Vendor can only see their own items
      if (!vendorId || vendorId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Vendors can only access their own items'
        });
      }

      const params = {
        TableName: WORKSPACE_ITEMS_TABLE,
        KeyConditionExpression: 'vendorId = :vendorId',
        ExpressionAttributeValues: {
          ':vendorId': { S: vendorId }
        }
      };
      const command = new QueryCommand(params);
      const { Items } = await dbClient.send(command);
      if (Items) {
        items = Items.map(item => unmarshall(item));
      }
    }

    // Transform data for frontend
    const transformedItems = items.map(item => ({
      id: item.itemId,
      name: item.name || 'Unnamed Item',
      description: item.description || '',
      type: item.type || 'Product',
      category: item.category || '-',
      unit: item.unit || '-',
      rate: item.rate ? `₹${item.rate}` : '-',
      gst: item.gst ? `${item.gst}%` : '%',
      status: item.status || 'Active',
      hsn: item.hsn ? `HSN: ${item.hsn}` : (item.sac ? `SAC: ${item.sac}` : ''),
      vendorId: item.vendorId
    }));

    res.status(200).json({
      success: true,
      data: transformedItems,
      count: transformedItems.length,
      message: `Successfully fetched ${transformedItems.length} items`
    });

  } catch (error) {
    console.error('❌ Error fetching items:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch items',
      error: error.message
    });
  }
};

/**
 * Update an existing item for a vendor
 * @route PUT /api/workspace/items/:itemId
 * @access Private (Vendor only)
 */
const updateItem = async (req, res) => {
  try {
    console.log('📦 UPDATE ITEM - Request body:', req.body);
    console.log('📦 UPDATE ITEM - Item ID:', req.params.itemId);
    console.log('📦 UPDATE ITEM - User:', req.user);

    const { itemId } = req.params;
    const { vendorId, name, description, type, unit, rate, hsn, sac, gst, status } = req.body;
    const userRole = req.user?.role;

    // Only vendors can update items
    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can update items'
      });
    }

    if (!itemId || !vendorId || !name || !rate) {
      return res.status(400).json({
        success: false,
        message: 'Item ID, Vendor ID, name, and rate are required'
      });
    }

    const updatedAt = new Date().toISOString();

    const updatedItem = {
      itemId,
      vendorId,
      name,
      description: description || '',
      type: type || 'Product',
      unit: unit || 'Nos',
      rate: parseFloat(rate),
      hsn: hsn || null,
      sac: sac || null,
      gst: gst || 18,
      status: status || 'Active',
      updatedAt
    };

    const params = {
      TableName: WORKSPACE_ITEMS_TABLE,
      Item: marshall(updatedItem)
    };

    await dbClient.send(new PutItemCommand(params));

    console.log(`✅ Updated item ${itemId} for vendor ${vendorId}`);

    res.status(200).json({
      success: true,
      data: updatedItem,
      message: 'Item updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating item:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update item',
      error: error.message
    });
  }
};

/**
 * Delete an item for a vendor
 * @route DELETE /api/workspace/items/:itemId
 * @access Private (Vendor only)
 */
const deleteItem = async (req, res) => {
  try {
    console.log('📦 DELETE ITEM - Item ID:', req.params.itemId);
    console.log('📦 DELETE ITEM - User:', req.user);

    const { itemId } = req.params;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    // Only vendors can delete items
    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can delete items'
      });
    }

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: 'Item ID is required'
      });
    }

    // First, check if the item exists and belongs to the vendor
    const getParams = {
      TableName: WORKSPACE_ITEMS_TABLE,
      Key: marshall({
        vendorId: userId,
        itemId: itemId
      })
    };

    const getResult = await dbClient.send(new GetItemCommand(getParams));

    if (!getResult.Item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found or access denied'
      });
    }

    // Delete the item
    const deleteParams = {
      TableName: WORKSPACE_ITEMS_TABLE,
      Key: marshall({
        vendorId: userId,
        itemId: itemId
      })
    };

    await dbClient.send(new DeleteItemCommand(deleteParams));

    console.log(`✅ Deleted item ${itemId} for vendor ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Item deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting item:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete item',
      error: error.message
    });
  }
};

/**
 * Update quotation PDF URL (after frontend generates styled PDF)
 * @route PATCH /api/workspace/quotations/:quotationId
 * @access Private (Vendor only)
 */
const updateQuotationPdfUrl = async (req, res) => {
  try {
    const { quotationId } = req.params;
    const { pdfUrl } = req.body;
    const userRole = req.user?.role;
    const vendorId = req.user?.vendorId;

    // Only vendors can update quotation PDFs
    if (userRole !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can update quotation PDFs'
      });
    }

    if (!vendorId || !quotationId || !pdfUrl) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID, quotation ID and pdfUrl are required'
      });
    }

    const updateParams = {
      TableName: WORKSPACE_QUOTATIONS_TABLE,
      Key: marshall({
        vendorId,
        quotationId
      }),
      UpdateExpression: 'SET #pdfUrl = :pdfUrl, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#pdfUrl': 'pdfUrl',
        '#updatedAt': 'updatedAt'
      },
      ExpressionAttributeValues: marshall({
        ':pdfUrl': pdfUrl,
        ':updatedAt': new Date().toISOString()
      }),
      ReturnValues: 'ALL_NEW'
    };

    const result = await dbClient.send(new UpdateItemCommand(updateParams));
    const updatedQuotation = unmarshall(result.Attributes);

    return res.status(200).json({
      success: true,
      data: updatedQuotation,
      message: 'Quotation PDF URL updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating quotation PDF URL:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update quotation PDF URL',
      error: error.message
    });
  }
};

export {
  // Quotations
  createQuotation,
  getQuotations,
  getQuotationsStats,
  updateQuotation,
  updateQuotationStatus,
  sendQuotationToPM,
  updateQuotationPdfUrl,

  // Invoices
  createInvoice,
  getInvoices,

  // Purchase Orders
  createPurchaseOrderFromQuote,

  // Credit Notes
  createCreditNote,

  // Items
  createItem,
  getItems,
  updateItem,
  deleteItem,

  // Customers
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  searchCustomers
};
