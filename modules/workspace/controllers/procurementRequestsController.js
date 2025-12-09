import { DynamoDBClient, PutItemCommand, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const PROCUREMENT_REQUESTS_TABLE = 'procurement_requests';
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
      workspaceId
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
    const { workspaceId, status, source } = req.query;
    console.log('📦 Fetching procurement requests with params:', { workspaceId, status, source });
    
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

export {
  createProcurementRequest,
  getProcurementRequests,
  getProcurementRequestById
};


