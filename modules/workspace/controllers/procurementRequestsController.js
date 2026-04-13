import { DynamoDBClient, PutItemCommand, QueryCommand, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const PROCUREMENT_REQUESTS_TABLE = 'procurement_requests';
const PM_PROJECTS_TABLE = 'pm_projects_table';
const SENT_RFQS_TABLE = process.env.SALES_SENT_RFQ_TABLE || process.env.SENT_RFQ_TABLE || 'sent_rfqs';
const VENDOR_QUOTATIONS_TABLE = process.env.SALES_QUOTATIONS_TABLE || process.env.QUOTATION_OF_VENDOR_TABLE || 'quotations_Of_Vendors';
const FINAL_QUOTATIONS_TABLE = process.env.DYNAMODB_QUOTATIONS || 'quotations';
const B2B_COMMISSION_TABLE = process.env.DYNAMODB_B2B_QUOTATIONS_WITH_COMMISSION || 'b2b_quotations_with_commission';
const B2B_INVOICES_TABLE = process.env.DYNAMODB_B2B_INVOICES || 'b2b_invoices';

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
 * Create a new procurement request
 * @route POST /api/procurement-requests
 * @access Private
 */
const createProcurementRequest = async (req, res) => {
  try {
    console.log('📦 Creating procurement request:', JSON.stringify(req.body, null, 2));
    
    // Get user info from the request (set by auth middleware or x-user-info header)
    let currentUser = req.user || {};
    
    // If user info is in header, parse it
    if (req.headers['x-user-info']) {
      try {
        const userInfo = JSON.parse(req.headers['x-user-info']);
        currentUser = { ...currentUser, ...userInfo };
      } catch (e) {
        console.log('⚠️ Could not parse x-user-info header');
      }
    }
    
    // Extract fields from request body
    const { 
      requestId,
      amount = 0,
      category = 'General',
      createdAt,
      department = 'Workspace',
      item,
      itemDescription = '',
      priority = 'medium',
      projectClientReference = null,
      quantity = 1,
      requestor,
      requiredByDate = null,
      sentOn,
      source = 'workspace',
      status = 'Pending',
      workspaceId,
      taskId = null,
      subtaskId = null,
      taskName = null,
      subtaskName = null,
      nodeId = null,
      materialType = null
    } = req.body;
    
    // Validate required fields
    if (!item || !workspaceId) {
      return res.status(400).json({
        success: false,
        message: 'Item and workspaceId are required fields'
      });
    }
    
    // Generate requestId if not provided
    const finalRequestId = requestId || `REQ-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const now = new Date();
    const finalCreatedAt = createdAt || now.toISOString();
    const finalSentOn = sentOn || now.toISOString().split('T')[0];
    
    // Resolve clientId & projectId from pm_projects_table based on workspaceId
    const projectContext = await getProjectContextForWorkspace(workspaceId);
    const clientId = projectContext?.clientId || null;
    const projectId = projectContext?.projectId || null;

    // Determine requestor as vendorId (from authenticated user / x-user-info)
    const vendorId =
      currentUser.vendorId ||
      currentUser.vendor_id || // fallback if different casing
      currentUser.id ||
      null;

    // Prepare the item for DynamoDB
    const procurementRequest = {
      requestId: finalRequestId,
      amount: typeof amount === 'number' ? amount : parseFloat(amount) || 0,
      category: category || 'General',
      createdAt: finalCreatedAt,
      department: department || 'Workspace',
      item: item.trim(),
      itemDescription: itemDescription || `Material request from workspace: ${workspaceId}`,
      priority: priority || 'medium',
      projectClientReference: projectClientReference || null,
      quantity: typeof quantity === 'number' ? quantity : parseInt(quantity) || 1,
      // Store vendorId as the requestor identifier
      requestor: requestor || vendorId || 'UNKNOWN_VENDOR',
      requiredByDate: requiredByDate || null,
      sentOn: finalSentOn,
      source: source || 'workspace',
      status: status || 'Pending',
      workspaceId: workspaceId,
      taskId: taskId || null,
      subtaskId: subtaskId || null,
      taskName: taskName || null,
      subtaskName: subtaskName || null,
      nodeId: nodeId || null,
      materialType: materialType || null,
      clientId: clientId || null,
      projectId: projectId || null
    };
    
    console.log('📦 Prepared procurement request item:', JSON.stringify(procurementRequest, null, 2));
    
    // Save to DynamoDB
    const params = {
      TableName: PROCUREMENT_REQUESTS_TABLE,
      Item: marshall(procurementRequest, { 
        removeUndefinedValues: true,
        convertClassInstanceToMap: true
      })
    };
    
    console.log('📦 DynamoDB params:', JSON.stringify(params, null, 2));
    
    await dbClient.send(new PutItemCommand(params));
    
    console.log(`✅ Created procurement request ${finalRequestId} for workspace ${workspaceId}`);
    
    res.status(201).json({
      success: true,
      message: 'Procurement request created successfully',
      data: procurementRequest
    });
    
  } catch (error) {
    console.error('❌ Error creating procurement request:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Request body:', JSON.stringify(req.body, null, 2));
    
    // More detailed error response
    const statusCode = error.name === 'ValidationException' ? 400 : 500;
    const errorMessage = error.name === 'ValidationException' 
      ? `Validation error: ${error.message}`
      : 'Failed to create procurement request';
      
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Get all procurement requests for a workspace
 * @route GET /api/procurement-requests
 * @access Private
 */
const getProcurementRequests = async (req, res) => {
  try {
    const { workspaceId, status, source, taskId, subtaskId } = req.query;
    console.log('📦 Fetching procurement requests with params:', { workspaceId, status, source, taskId, subtaskId });
    
    // Build filter expression
    let filterExpression = '';
    const expressionAttributeValues = {};
    const expressionAttributeNames = {};
    
    if (workspaceId) {
      filterExpression = '#workspaceId = :workspaceId';
      expressionAttributeNames['#workspaceId'] = 'workspaceId';
      expressionAttributeValues[':workspaceId'] = { S: workspaceId };
    }
    
    if (status) {
      if (filterExpression) filterExpression += ' AND ';
      else filterExpression = '';
      filterExpression += '#status = :status';
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = { S: status };
    }
    
    if (source) {
      if (filterExpression) filterExpression += ' AND ';
      else filterExpression = '';
      filterExpression += '#source = :source';
      expressionAttributeNames['#source'] = 'source';
      expressionAttributeValues[':source'] = { S: source };
    }

    if (taskId) {
      if (filterExpression) filterExpression += ' AND ';
      else filterExpression = '';
      filterExpression += '#taskId = :taskId';
      expressionAttributeNames['#taskId'] = 'taskId';
      expressionAttributeValues[':taskId'] = { S: taskId };
    }

    if (subtaskId) {
      if (filterExpression) filterExpression += ' AND ';
      else filterExpression = '';
      filterExpression += '#subtaskId = :subtaskId';
      expressionAttributeNames['#subtaskId'] = 'subtaskId';
      expressionAttributeValues[':subtaskId'] = { S: subtaskId };
    }
    
    let params = {
      TableName: PROCUREMENT_REQUESTS_TABLE
    };
    
    // If we have filters, use Scan with FilterExpression
    if (filterExpression) {
      params.FilterExpression = filterExpression;
      params.ExpressionAttributeNames = expressionAttributeNames;
      params.ExpressionAttributeValues = expressionAttributeValues;
    }
    
    const result = await dbClient.send(new ScanCommand(params));
    
    const requests = result.Items.map(item => unmarshall(item));
    
    // Sort by createdAt descending (newest first)
    requests.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0);
      const dateB = new Date(b.createdAt || 0);
      return dateB - dateA;
    });
    
    res.status(200).json({
      success: true,
      message: 'Procurement requests retrieved successfully',
      data: requests,
      count: requests.length
    });
    
  } catch (error) {
    console.error('❌ Error fetching procurement requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch procurement requests',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get a single procurement request by ID
 * @route GET /api/procurement-requests/:requestId
 * @access Private
 */
const getProcurementRequestById = async (req, res) => {
  try {
    const { requestId } = req.params;
    
    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: 'Request ID is required'
      });
    }
    
    // Scan for the specific requestId
    const params = {
      TableName: PROCUREMENT_REQUESTS_TABLE,
      FilterExpression: '#requestId = :requestId',
      ExpressionAttributeNames: {
        '#requestId': 'requestId'
      },
      ExpressionAttributeValues: {
        ':requestId': { S: requestId }
      }
    };
    
    const result = await dbClient.send(new ScanCommand(params));
    
    if (result.Items.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Procurement request not found'
      });
    }
    
    const request = unmarshall(result.Items[0]);
    
    res.status(200).json({
      success: true,
      message: 'Procurement request retrieved successfully',
      data: request
    });
    
  } catch (error) {
    console.error('❌ Error fetching procurement request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch procurement request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Update an existing procurement request
 * @route PUT /api/procurement-requests/:requestId
 * @access Private
 */
const updateProcurementRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    
    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: 'Request ID is required'
      });
    }

    console.log(`📦 Updating procurement request: ${requestId}`, JSON.stringify(req.body, null, 2));
    
    // Get user info from the request (set by auth middleware or x-user-info header)
    let currentUser = req.user || {};
    
    // If user info is in header, parse it
    if (req.headers['x-user-info']) {
      try {
        const userInfo = JSON.parse(req.headers['x-user-info']);
        currentUser = { ...currentUser, ...userInfo };
      } catch (e) {
        console.log('⚠️ Could not parse x-user-info header');
      }
    }
    
    // Extract fields from request body
    const { 
      amount,
      category,
      department,
      item,
      itemDescription,
      priority,
      projectClientReference,
      quantity,
      requestor,
      requiredByDate,
      sentOn,
      source,
      status,
      workspaceId,
      taskId,
      subtaskId,
      taskName,
      subtaskName,
      nodeId,
      materialType
    } = req.body;

    // Build update expression dynamically
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};
    
    const now = new Date();
    
    // Add updatedAt timestamp
    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = { S: now.toISOString() };
    
    // Add each field if provided
    if (amount !== undefined) {
      updateExpressions.push('#amount = :amount');
      expressionAttributeNames['#amount'] = 'amount';
      expressionAttributeValues[':amount'] = { N: String(typeof amount === 'number' ? amount : parseFloat(amount) || 0) };
    }
    
    if (category !== undefined) {
      updateExpressions.push('#category = :category');
      expressionAttributeNames['#category'] = 'category';
      expressionAttributeValues[':category'] = { S: category || 'General' };
    }
    
    if (department !== undefined) {
      updateExpressions.push('#department = :department');
      expressionAttributeNames['#department'] = 'department';
      expressionAttributeValues[':department'] = { S: department || 'Workspace' };
    }
    
    if (item !== undefined) {
      updateExpressions.push('#item = :item');
      expressionAttributeNames['#item'] = 'item';
      expressionAttributeValues[':item'] = { S: item.trim() };
    }
    
    if (itemDescription !== undefined) {
      updateExpressions.push('#itemDescription = :itemDescription');
      expressionAttributeNames['#itemDescription'] = 'itemDescription';
      expressionAttributeValues[':itemDescription'] = { S: itemDescription || '' };
    }
    
    if (priority !== undefined) {
      updateExpressions.push('#priority = :priority');
      expressionAttributeNames['#priority'] = 'priority';
      expressionAttributeValues[':priority'] = { S: priority || 'medium' };
    }
    
    if (projectClientReference !== undefined) {
      updateExpressions.push('#projectClientReference = :projectClientReference');
      expressionAttributeNames['#projectClientReference'] = 'projectClientReference';
      expressionAttributeValues[':projectClientReference'] = projectClientReference === null ? { NULL: true } : { S: projectClientReference };
    }
    
    if (quantity !== undefined) {
      updateExpressions.push('#quantity = :quantity');
      expressionAttributeNames['#quantity'] = 'quantity';
      expressionAttributeValues[':quantity'] = { N: String(typeof quantity === 'number' ? quantity : parseInt(quantity) || 1) };
    }
    
    if (requestor !== undefined) {
      updateExpressions.push('#requestor = :requestor');
      expressionAttributeNames['#requestor'] = 'requestor';
      expressionAttributeValues[':requestor'] = { S: requestor || 'UNKNOWN_VENDOR' };
    }
    
    if (requiredByDate !== undefined) {
      updateExpressions.push('#requiredByDate = :requiredByDate');
      expressionAttributeNames['#requiredByDate'] = 'requiredByDate';
      expressionAttributeValues[':requiredByDate'] = requiredByDate === null ? { NULL: true } : { S: requiredByDate };
    }
    
    if (sentOn !== undefined) {
      updateExpressions.push('#sentOn = :sentOn');
      expressionAttributeNames['#sentOn'] = 'sentOn';
      expressionAttributeValues[':sentOn'] = { S: sentOn };
    }
    
    if (source !== undefined) {
      updateExpressions.push('#source = :source');
      expressionAttributeNames['#source'] = 'source';
      expressionAttributeValues[':source'] = { S: source || 'workspace' };
    }
    
    if (status !== undefined) {
      updateExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = { S: status || 'Pending' };
    }
    
    if (workspaceId !== undefined) {
      updateExpressions.push('#workspaceId = :workspaceId');
      expressionAttributeNames['#workspaceId'] = 'workspaceId';
      expressionAttributeValues[':workspaceId'] = { S: workspaceId };
    }

    if (taskId !== undefined) {
      updateExpressions.push('#taskId = :taskId');
      expressionAttributeNames['#taskId'] = 'taskId';
      expressionAttributeValues[':taskId'] = taskId === null ? { NULL: true } : { S: taskId };
    }

    if (subtaskId !== undefined) {
      updateExpressions.push('#subtaskId = :subtaskId');
      expressionAttributeNames['#subtaskId'] = 'subtaskId';
      expressionAttributeValues[':subtaskId'] = subtaskId === null ? { NULL: true } : { S: subtaskId };
    }

    if (taskName !== undefined) {
      updateExpressions.push('#taskName = :taskName');
      expressionAttributeNames['#taskName'] = 'taskName';
      expressionAttributeValues[':taskName'] = taskName === null ? { NULL: true } : { S: taskName };
    }

    if (subtaskName !== undefined) {
      updateExpressions.push('#subtaskName = :subtaskName');
      expressionAttributeNames['#subtaskName'] = 'subtaskName';
      expressionAttributeValues[':subtaskName'] = subtaskName === null ? { NULL: true } : { S: subtaskName };
    }

    if (nodeId !== undefined) {
      updateExpressions.push('#nodeId = :nodeId');
      expressionAttributeNames['#nodeId'] = 'nodeId';
      expressionAttributeValues[':nodeId'] = nodeId === null ? { NULL: true } : { S: nodeId };
    }

    if (materialType !== undefined) {
      updateExpressions.push('#materialType = :materialType');
      expressionAttributeNames['#materialType'] = 'materialType';
      expressionAttributeValues[':materialType'] = materialType === null ? { NULL: true } : { S: materialType };
    }
    
    // If no fields to update, return error
    if (updateExpressions.length === 1) { // Only updatedAt was added
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }
    
    // Update the item in DynamoDB
    const params = {
      TableName: PROCUREMENT_REQUESTS_TABLE,
      Key: marshall({ requestId }),
      UpdateExpression: 'SET ' + updateExpressions.join(', '),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };
    
    console.log(`📦 Update params for ${requestId}:`, JSON.stringify(params, null, 2));
    
    const result = await dbClient.send(new UpdateItemCommand(params));
    const updatedRequest = unmarshall(result.Attributes);
    
    console.log(`✅ Updated procurement request ${requestId}`);
    
    res.status(200).json({
      success: true,
      message: 'Procurement request updated successfully',
      data: updatedRequest
    });
    
  } catch (error) {
    console.error('❌ Error updating procurement request:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Request body:', JSON.stringify(req.body, null, 2));
    
    // More detailed error response
    const statusCode = error.name === 'ValidationException' ? 400 : 500;
    const errorMessage = error.name === 'ValidationException' 
      ? `Validation error: ${error.message}`
      : 'Failed to update procurement request';
      
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Get CRM orders with full pipeline status for a workspace
 * Aggregates: procurement_requests → sent_rfqs → vendor quotations → final quotation → commission
 * @route GET /api/procurement-requests/crm-orders
 * @access Private
 */
const getCrmOrders = async (req, res) => {
  try {
    const { workspaceId, taskId, subtaskId } = req.query;
    if (!workspaceId) {
      return res.status(400).json({ success: false, message: 'workspaceId is required' });
    }

    // Step 1: Get workspace orders for this workspace.
    // Keep CRM sources, include workspace/workspace-rfq sources, and include legacy rows without source.
    let filterExpression = '#workspaceId = :workspaceId AND (attribute_not_exists(#source) OR #source = :sourceCrmUpper OR #source = :sourceCrmLower OR #source = :sourceWorkspace OR #source = :sourceWorkspaceRfq)';
    const expressionAttributeNames = {
      '#workspaceId': 'workspaceId',
      '#source': 'source'
    };
    const expressionAttributeValues = {
      ':workspaceId': { S: workspaceId },
      ':sourceCrmUpper': { S: 'CRM' },
      ':sourceCrmLower': { S: 'crm' },
      ':sourceWorkspace': { S: 'workspace' },
      ':sourceWorkspaceRfq': { S: 'workspace-rfq' }
    };

    if (taskId) {
      filterExpression += ' AND #taskId = :taskId';
      expressionAttributeNames['#taskId'] = 'taskId';
      expressionAttributeValues[':taskId'] = { S: taskId };
    }
    if (subtaskId) {
      filterExpression += ' AND #subtaskId = :subtaskId';
      expressionAttributeNames['#subtaskId'] = 'subtaskId';
      expressionAttributeValues[':subtaskId'] = { S: subtaskId };
    }

    const procResult = await dbClient.send(new ScanCommand({
      TableName: PROCUREMENT_REQUESTS_TABLE,
      FilterExpression: filterExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    }));

    const requests = (procResult.Items || []).map(item => unmarshall(item));
    if (requests.length === 0) {
      return res.json({ success: true, orders: [] });
    }

    // Step 2: For each request, find sent_rfqs where enquiryId = requestId
    const requestIds = requests.map(r => r.requestId);

    // Batch scan sent_rfqs for all matching enquiryIds
    const sentRfqResult = await dbClient.send(new ScanCommand({
      TableName: SENT_RFQS_TABLE
    }));
    const allSentRfqs = (sentRfqResult.Items || []).map(item => unmarshall(item));

    // Map enquiryId → sent_rfq records
    const sentRfqsByEnquiry = {};
    for (const rfq of allSentRfqs) {
      const eid = rfq.enquiryId;
      if (eid && requestIds.includes(eid)) {
        if (!sentRfqsByEnquiry[eid]) sentRfqsByEnquiry[eid] = [];
        sentRfqsByEnquiry[eid].push(rfq);
      }
    }

    // Step 3: Get vendor quotations linked to these sent_rfqs
    const sentRfqIds = allSentRfqs
      .filter(r => requestIds.includes(r.enquiryId))
      .map(r => r.sentRfqId);

    let vendorQuotations = [];
    if (sentRfqIds.length > 0) {
      const vqResult = await dbClient.send(new ScanCommand({
        TableName: VENDOR_QUOTATIONS_TABLE
      }));
      vendorQuotations = (vqResult.Items || []).map(item => unmarshall(item))
        .filter(q => q.sentRfqId && sentRfqIds.includes(q.sentRfqId));
    }

    // Map sentRfqId → vendor quotations
    const vqBySentRfq = {};
    for (const vq of vendorQuotations) {
      if (!vqBySentRfq[vq.sentRfqId]) vqBySentRfq[vq.sentRfqId] = [];
      vqBySentRfq[vq.sentRfqId].push(vq);
    }

    // Step 4: Get final quotations where rfqId matches a requestId
    let finalQuotations = [];
    try {
      const fqResult = await dbClient.send(new ScanCommand({
        TableName: FINAL_QUOTATIONS_TABLE
      }));
      finalQuotations = (fqResult.Items || []).map(item => unmarshall(item))
        .filter(fq => fq.rfqId && requestIds.includes(fq.rfqId));
    } catch (err) {
      console.warn('Could not fetch final quotations:', err.message);
    }


    // Map rfqId → final quotations
    const fqByRfqId = {};
    for (const fq of finalQuotations) {
      if (!fqByRfqId[fq.rfqId]) fqByRfqId[fq.rfqId] = [];
      fqByRfqId[fq.rfqId].push(fq);
    }

    // Step 5: Get commission/invoice records for matching final quotations.
    // Support legacy/alternate key names used across systems:
    // quotationsId, quotationId, and metadata.quotationId.
    const finalQuotationIds = finalQuotations
      .map(fq => fq.quotationsId || fq.quotationId)
      .filter(Boolean);
    const requestedOrderIds = new Set(requestIds);
    const commissionRecords = [];

    const candidateTables = [...new Set([B2B_COMMISSION_TABLE, B2B_INVOICES_TABLE])];
    for (const tableName of candidateTables) {
      try {
        const tableResult = await dbClient.send(new ScanCommand({ TableName: tableName }));
        const tableItems = (tableResult.Items || []).map(item => unmarshall(item));

        for (const record of tableItems) {
          const recordQuotationId =
            record.quotationsId ||
            record.quotationId ||
            record.metadata?.quotationId ||
            null;
          const recordSourceOrderId =
            record.sourceOrderId ||
            record.metadata?.sourceOrderId ||
            null;

          if (
            (recordQuotationId && finalQuotationIds.includes(recordQuotationId)) ||
            (recordSourceOrderId && requestedOrderIds.has(recordSourceOrderId))
          ) {
            commissionRecords.push(record);
          }
        }
      } catch (err) {
        console.warn(`Could not fetch records from ${tableName}:`, err.message);
      }
    }

    // Deduplicate by strongest available identity.
    const dedupedCommissionRecords = [];
    const seenCommissionKeys = new Set();
    for (const record of commissionRecords) {
      const dedupeKey =
        record.commissionRecordId ||
        record.invoiceId ||
        record.quotationsId ||
        record.quotationId ||
        `${record.sourceOrderId || record.metadata?.sourceOrderId || 'unknown'}:${record.purchaseOrderId || 'unknown'}`;
      if (seenCommissionKeys.has(dedupeKey)) continue;
      seenCommissionKeys.add(dedupeKey);
      dedupedCommissionRecords.push(record);
    }

    // Map quotation/source order IDs → commission record(s)
    const crByQuotationId = {};
    const crBySourceOrderId = {};
    for (const cr of dedupedCommissionRecords) {
      const quotationKeys = [cr.quotationsId, cr.quotationId, cr.metadata?.quotationId].filter(Boolean);
      for (const quotationKey of quotationKeys) {
        crByQuotationId[quotationKey] = cr;
      }

      const sourceOrderKey = cr.sourceOrderId || cr.metadata?.sourceOrderId;
      if (sourceOrderKey) {
        if (!crBySourceOrderId[sourceOrderKey]) crBySourceOrderId[sourceOrderKey] = [];
        crBySourceOrderId[sourceOrderKey].push(cr);
      }
    }

    // Step 6: Assemble aggregated orders
    const orders = requests.map(request => {
      const sentRfqs = sentRfqsByEnquiry[request.requestId] || [];
      
      // Aggregate vendor quotations across all sent RFQs for this request
      const allVendorQuotes = [];
      for (const rfq of sentRfqs) {
        const quotes = vqBySentRfq[rfq.sentRfqId] || [];
        allVendorQuotes.push(...quotes);
      }

      // Final quotations and commissions for this request
      const finals = fqByRfqId[request.requestId] || [];
      const commissions = [];
      const seenCommissionIds = new Set();

      for (const fq of finals) {
        const quotationKeys = [fq.quotationsId, fq.quotationId].filter(Boolean);
        for (const quotationKey of quotationKeys) {
          const record = crByQuotationId[quotationKey];
          if (!record) continue;
          const key = record.commissionRecordId || record.invoiceId || quotationKey;
          if (seenCommissionIds.has(key)) continue;
          seenCommissionIds.add(key);
          commissions.push(record);
        }
      }

      const sourceOrderCommissions = crBySourceOrderId[request.requestId] || [];
      for (const record of sourceOrderCommissions) {
        const key =
          record.commissionRecordId ||
          record.invoiceId ||
          record.quotationsId ||
          record.quotationId ||
          request.requestId;
        if (seenCommissionIds.has(key)) continue;
        seenCommissionIds.add(key);
        commissions.push(record);
      }

      const primaryInvoiceRecord = commissions.find((record) =>
        Boolean(
          record.commissionedInvoicePdfUrl ||
          record.invoicePdfUrl ||
          record.summary?.commissionedInvoicePdfUrl ||
          record.summary?.invoicePdfUrl ||
          record.metadata?.commissionedInvoicePdfUrl ||
          record.metadata?.invoicePdfUrl
        )
      );
      const invoiceReady = Boolean(primaryInvoiceRecord);
      const invoicePdfUrl =
        primaryInvoiceRecord?.commissionedInvoicePdfUrl ||
        primaryInvoiceRecord?.invoicePdfUrl ||
        primaryInvoiceRecord?.summary?.commissionedInvoicePdfUrl ||
        primaryInvoiceRecord?.summary?.invoicePdfUrl ||
        primaryInvoiceRecord?.metadata?.commissionedInvoicePdfUrl ||
        primaryInvoiceRecord?.metadata?.invoicePdfUrl ||
        null;

      // Determine pipeline stage for vendor view.
      // Once finance adds commission, mark as commissioned (do not mark as sent_to_client here).
      let pipelineStage = 'procurement_request';
      if (commissions.length > 0) {
        pipelineStage = 'commissioned';
      } else if (finals.length > 0) {
        pipelineStage = finals[0].commissioned ? 'commissioned' : 'final_quotation_created';
      } else if (allVendorQuotes.length > 0) {
        pipelineStage = 'vendor_quotes_received';
      } else if (sentRfqs.length > 0) {
        pipelineStage = 'rfq_sent';
      }

      return {
        ...request,
        pipeline: {
          stage: pipelineStage,
          rfqsSent: sentRfqs.length,
          vendorQuotesReceived: allVendorQuotes.length,
          finalQuotations: finals.length,
          commissionAdded: commissions.length > 0,
          invoiceReady,
          invoicePdfUrl,
          sentToClient: false,
          sentRfqs: sentRfqs.map(r => ({
            sentRfqId: r.sentRfqId,
            vendorIds: r.vendorIds,
            status: r.status,
            createdAt: r.createdAt
          })),
          vendorQuotations: allVendorQuotes.map(vq => ({
            quotationId: vq.quotationId,
            vendorId: vq.vendorId,
            rate: vq.rate,
            quantity: vq.quantity,
            item: vq.item,
            status: vq.status,
            pdfUrl: vq.pdfUrl,
            createdAt: vq.createdAt
          })),
          finalQuotations: finals.map(fq => ({
            quotationsId: fq.quotationsId,
            amount: fq.amount,
            productName: fq.productName,
            status: fq.status,
            commissioned: fq.commissioned || false,
            createdAt: fq.createdAt,
            pdfUrl:
              fq.commissionedQuotationUrl ||
              fq.commissionedPdfUrl ||
              fq.pdfUrl ||
              fq.quotationPdfUrl ||
              fq.quotation_pdf_url ||
              null,
            commissionedQuotationUrl: fq.commissionedQuotationUrl || null,
            commissionedPdfUrl: fq.commissionedPdfUrl || null
          })),
          commissionRecords: commissions.map(cr => ({
            commissionRecordId: cr.commissionRecordId,
            quotationId: cr.quotationId || cr.quotationsId || null,
            invoiceId: cr.invoiceId || null,
            status: cr.status,
            summary: cr.summary,
            recordedAt: cr.recordedAt,
            commissionedInvoicePdfUrl:
              cr.commissionedInvoicePdfUrl ||
              cr.summary?.commissionedInvoicePdfUrl ||
              cr.metadata?.commissionedInvoicePdfUrl ||
              null,
            invoicePdfUrl:
              cr.invoicePdfUrl ||
              cr.summary?.invoicePdfUrl ||
              cr.metadata?.invoicePdfUrl ||
              null,
            invoiceReady: Boolean(
              cr.commissionedInvoicePdfUrl ||
              cr.invoicePdfUrl ||
              cr.summary?.commissionedInvoicePdfUrl ||
              cr.summary?.invoicePdfUrl ||
              cr.metadata?.commissionedInvoicePdfUrl ||
              cr.metadata?.invoicePdfUrl
            ),
            pdfUrl:
              cr.pdfUrl ||
              cr.commissionedQuotationUrl ||
              cr.commissionedPdfUrl ||
              cr.summary?.commissionedQuotationUrl ||
              cr.summary?.pdfUrl ||
              cr.metadata?.commissionedQuotationUrl ||
              cr.metadata?.pdfUrl ||
              null
          }))
        }
      };
    });

    res.json({ success: true, orders });
  } catch (error) {
    console.error('❌ Error fetching CRM orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch CRM orders',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export {
  createProcurementRequest,
  getProcurementRequests,
  getProcurementRequestById,
  updateProcurementRequest,
  getCrmOrders
};


