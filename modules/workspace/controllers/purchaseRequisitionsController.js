import { DynamoDBClient, PutItemCommand, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const PURCHASE_REQUISITIONS_TABLE = 'purchase_requisitions';

/**
 * Create a new purchase requisition
 * @route POST /api/workspace/purchase-requisitions
 * @access Private
 */
const createPurchaseRequisition = async (req, res) => {
  try {
    console.log('🔵 Request body:', JSON.stringify(req.body, null, 2));
    
    // Get user info from the request (set by auth middleware)
    const currentUser = req.user || {};
    
    // Log the incoming request for debugging
    console.log('🔵 Request body:', JSON.stringify(req.body, null, 2));
    console.log('🔵 Current user from auth:', JSON.stringify(currentUser, null, 2));
    
    // Ensure we have the required vendor ID
    if (!currentUser.vendorId && !req.body.vendorId) {
      console.error('❌ Missing vendor ID in request');
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required',
        details: 'No vendor ID found in user session or request body'
      });
    }
    
    // Extract fields from request body with proper defaults
    const { 
      title,
      description = '',
      priority = 'medium',
      requiredBy,
      items = [],
      notes = '',
      status = 'draft',
      vendorId = currentUser.vendorId,
      workspaceId,
      contact_person = currentUser.name || 'Not specified',
      contact_phone = currentUser.phone || 'Not specified',
      delivery_address = 'Not specified',
      purpose_of_purchase = 'General purchase',
      from_crm = false
    } = req.body;
    
    // Log extracted fields for debugging
    console.log('🔵 Extracted fields:', {
      title,
      vendorId,
      workspaceId,
      contact_person,
      contact_phone,
      itemsCount: items.length
    });

    if (!title || !vendorId || !workspaceId) {
      return res.status(400).json({
        success: false,
        message: 'Title, vendorId, and workspaceId are required fields'
      });
    }

    // Generate a unique ID for the requisition
    const requisitionId = `PR-${Date.now()}-${uuidv4().substring(0, 6)}`;
    const now = new Date().toISOString();

    console.log('🔵 Current user from request:', JSON.stringify(currentUser, null, 2));
    
    // Calculate total cost
    const totalCost = items.reduce((sum, item) => {
      return sum + (parseFloat(item.estimatedCost) || 0) * (parseInt(item.quantity) || 0);
    }, 0);
    
    // Log the workspaceId and vendorId for debugging
    console.log('🔵 Workspace ID:', workspaceId);
    console.log('🔵 Vendor ID:', vendorId);

    // Prepare the item for DynamoDB - matching the required JSON structure
    // Ensure we have required user information
    const userContactPerson = contact_person || 
                            currentUser?.name || 
                            'Not specified';
    const userContactPhone = contact_phone || 
                           currentUser?.phone || 
                           'Not specified';
    
    const requisition = {
      requisition_id: requisitionId,
      vendor_id: vendorId,
      project_id: workspaceId, // workspaceId maps to project_id
      contact_person: userContactPerson,
      contact_phone: userContactPhone,
      delivery_address: delivery_address || 'Not specified',
      expected_delivery_date: requiredBy || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      from_crm,
      items: items.map(item => ({
        item_name: item.name || item.item_name || 'Unnamed Item',
        item_description: item.description || item.item_description || '',
        quantity: parseInt(item.quantity) || 1,
        estimated_unit_price: parseFloat(item.estimatedCost || item.estimated_unit_price) || 0,
        category: item.category || 'Uncategorized',
        preferred_supplier_id: item.vendor || item.preferred_supplier_id || '',
        unit: item.unit || 'pcs'
      })),
      notes_for_pm: notes || '',
      purpose_of_purchase: purpose_of_purchase || description || 'General purchase',
      request_date: new Date().toISOString().split('T')[0],
      status: status || 'pending',
      urgency_level: ['low', 'medium', 'high'].includes(priority) ? 
        priority.charAt(0).toUpperCase() + priority.slice(1) : 'Medium',
      created_at: now,
      updated_at: now,
      // Add additional fields for compatibility
      title,
      description,
      total_cost: items.reduce((sum, item) => {
        return sum + (parseFloat(item.estimatedCost || item.estimated_unit_price) || 0) * (parseInt(item.quantity) || 0);
      }, 0)
    };

    console.log('🔵 Prepared requisition item:', JSON.stringify(requisition, null, 2));
    console.log('🔵 Request headers:', JSON.stringify(req.headers, null, 2));

    const params = {
      TableName: PURCHASE_REQUISITIONS_TABLE,
      Item: marshall(requisition, { 
        removeUndefinedValues: true,
        convertClassInstanceToMap: true
      })
    };

    console.log('🔵 DynamoDB params:', JSON.stringify(params, null, 2));

    await dbClient.send(new PutItemCommand(params));

    console.log(`✅ Created purchase requisition ${requisitionId} for vendor ${vendorId}`);

    res.status(201).json({
      success: true,
      message: 'Purchase requisition created successfully',
      data: requisition
    });

  } catch (error) {
    console.error('❌ Error creating purchase requisition:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Request body:', JSON.stringify(req.body, null, 2));
    
    // More detailed error response
    const statusCode = error.name === 'ValidationException' ? 400 : 500;
    const errorMessage = error.name === 'ValidationException' 
      ? `Validation error: ${error.message}`
      : 'Failed to create purchase requisition';
      
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Get all purchase requisitions for a vendor
 * @route GET /api/workspace/purchase-requisitions
 * @access Private
 */
const getPurchaseRequisitions = async (req, res) => {
  try {
    const { vendorId, workspaceId, status } = req.query;
    console.log('🔵 Fetching purchase requisitions with params:', { vendorId, workspaceId, status });

    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID is required',
        details: 'No vendor ID provided in query parameters'
      });
    }

    // Use the correct field names that match how data is stored
    let filterExpression = 'vendor_id = :vendorId';
    const expressionAttributeValues = {
      ':vendorId': { S: vendorId }
    };
    
    let expressionAttributeNames = {};

    // Add workspace filter if provided
    if (workspaceId) {
      filterExpression += ' AND project_id = :workspaceId';
      expressionAttributeValues[':workspaceId'] = { S: workspaceId };
    }

    // Add status filter if provided
    if (status) {
      filterExpression += ' AND #status = :status';
      expressionAttributeValues[':status'] = { S: status };
      expressionAttributeNames['#status'] = 'status';
    }
    
    console.log('🔵 DynamoDB query params:', {
      filterExpression,
      expressionAttributeValues,
      expressionAttributeNames
    });

    // Build the params object with conditional inclusion of ExpressionAttributeNames
    const params = {
      TableName: PURCHASE_REQUISITIONS_TABLE,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues
    };
    
    // Only include ExpressionAttributeNames if it has properties
    if (Object.keys(expressionAttributeNames).length > 0) {
      params.ExpressionAttributeNames = expressionAttributeNames;
    }

    console.log('🔍 Executing DynamoDB scan...');
    const result = await dbClient.send(new ScanCommand(params));
    
    // Unmarshall the items
    const items = result.Items ? result.Items.map(item => unmarshall(item)) : [];
    
    console.log(`✅ Found ${items.length} purchase requisitions`);
    
    res.status(200).json({
      success: true,
      data: items
    });

  } catch (error) {
    console.error('❌ Error fetching purchase requisitions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase requisitions',
      error: error.message
    });
  }
};

/**
 * Get a single purchase requisition by ID
 * @route GET /api/workspace/purchase-requisitions/:requisitionId
 * @access Private
 */
const getPurchaseRequisitionById = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { vendorId } = req.query;

    if (!requisitionId || !vendorId) {
      return res.status(400).json({
        success: false,
        message: 'Requisition ID and Vendor ID are required'
      });
    }

    const params = {
      TableName: PURCHASE_REQUISITIONS_TABLE,
      FilterExpression: 'requisitionId = :requisitionId AND vendorId = :vendorId',
      ExpressionAttributeValues: {
        ':requisitionId': { S: requisitionId },
        ':vendorId': { S: vendorId }
      }
    };

    const { Items } = await dbClient.send(new ScanCommand(params));
    
    if (!Items || Items.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Purchase requisition not found'
      });
    }

    const requisition = unmarshall(Items[0]);

    res.status(200).json({
      success: true,
      data: requisition,
      message: 'Purchase requisition retrieved successfully'
    });

  } catch (error) {
    console.error('❌ Error fetching purchase requisition:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase requisition',
      error: error.message
    });
  }
};

/**
 * Update a purchase requisition
 * @route PUT /api/workspace/purchase-requisitions/:requisitionId
 * @access Private
 */
const updatePurchaseRequisition = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { vendorId, status, notes } = req.body;

    if (!requisitionId || !vendorId) {
      return res.status(400).json({
        success: false,
        message: 'Requisition ID and Vendor ID are required'
      });
    }

    // First, get the existing requisition
    const getParams = {
      TableName: PURCHASE_REQUISITIONS_TABLE,
      FilterExpression: 'requisitionId = :requisitionId AND vendorId = :vendorId',
      ExpressionAttributeValues: {
        ':requisitionId': { S: requisitionId },
        ':vendorId': { S: vendorId }
      }
    };

    const { Items } = await dbClient.send(new ScanCommand(getParams));
    
    if (!Items || Items.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Purchase requisition not found'
      });
    }

    const existingRequisition = unmarshall(Items[0]);

    // Update only the allowed fields
    const updatedRequisition = {
      ...existingRequisition,
      status: status || existingRequisition.status,
      notes: notes !== undefined ? notes : existingRequisition.notes,
      updatedAt: new Date().toISOString()
    };

    // Save the updated requisition
    const updateParams = {
      TableName: PURCHASE_REQUISITIONS_TABLE,
      Item: marshall(updatedRequisition, { removeUndefinedValues: true })
    };

    await dbClient.send(new PutItemCommand(updateParams));

    res.status(200).json({
      success: true,
      data: updatedRequisition,
      message: 'Purchase requisition updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating purchase requisition:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update purchase requisition',
      error: error.message
    });
  }
};

export {
  createPurchaseRequisition,
  getPurchaseRequisitions,
  getPurchaseRequisitionById,
  updatePurchaseRequisition
};
