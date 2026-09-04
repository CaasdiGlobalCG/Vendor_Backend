import { dynamoDB } from '../config/aws.js';
import AWS from 'aws-sdk';

const ITEMS_TABLE = 'items_for_quotations';

// Create raw DynamoDB client for scanning
const rawDynamoDB = new AWS.DynamoDB({
  region: process.env.AWS_REGION || 'ap-south-1',
  
});

// Helper function to convert DynamoDB format to regular JSON
const convertDynamoDBToJSON = (item) => {
  return AWS.DynamoDB.Converter.unmarshall(item);
};

// Get all items
export const getItems = async (req, res) => {
  try {
    console.log('📦 Fetching all items from items_for_quotations table');

    const params = {
      TableName: ITEMS_TABLE
    };

    const result = await rawDynamoDB.scan(params).promise();
    
    if (!result.Items || result.Items.length === 0) {
      console.log('📦 No items found in table');
      return res.status(200).json({
        success: true,
        message: 'No items found',
        data: []
      });
    }

    // Convert DynamoDB format to regular JSON
    const items = result.Items.map(convertDynamoDBToJSON);
    
    console.log(`✅ Successfully fetched ${items.length} items`);
    
    res.status(200).json({
      success: true,
      data: items,
      count: items.length
    });

  } catch (error) {
    console.error('❌ Error fetching items:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching items',
      error: error.message
    });
  }
};

// Get item by ID
export const getItemById = async (req, res) => {
  try {
    const { itemId } = req.params;
    console.log(`📦 Fetching item with ID: ${itemId}`);

    const params = {
      TableName: ITEMS_TABLE,
      Key: {
        itemId: { S: itemId }
      }
    };

    const result = await rawDynamoDB.getItem(params).promise();
    
    if (!result.Item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    const item = convertDynamoDBToJSON(result.Item);
    
    console.log('✅ Successfully fetched item');
    
    res.status(200).json({
      success: true,
      data: item
    });

  } catch (error) {
    console.error('❌ Error fetching item:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching item',
      error: error.message
    });
  }
};

// Create new item
export const createItem = async (req, res) => {
  try {
    const itemData = req.body;
    console.log('📦 Creating new item:', itemData);

    // Generate unique item ID
    const itemId = `ITEM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const newItem = {
      itemId,
      ...itemData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: itemData.status || 'Active'
    };

    const params = {
      TableName: ITEMS_TABLE,
      Item: newItem
    };

    await dynamoDB.put(params).promise();
    
    console.log('✅ Successfully created item');
    
    res.status(201).json({
      success: true,
      message: 'Item created successfully',
      data: newItem
    });

  } catch (error) {
    console.error('❌ Error creating item:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating item',
      error: error.message
    });
  }
};

// Update item
export const updateItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const updateData = req.body;
    console.log(`📦 Updating item ${itemId}:`, updateData);

    // Build update expression
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    Object.keys(updateData).forEach((key, index) => {
      if (key !== 'itemId') { // Don't update the primary key
        const attrName = `#attr${index}`;
        const attrValue = `:val${index}`;
        
        updateExpressions.push(`${attrName} = ${attrValue}`);
        expressionAttributeNames[attrName] = key;
        expressionAttributeValues[attrValue] = updateData[key];
      }
    });

    // Add updatedAt timestamp
    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date().toISOString();

    const params = {
      TableName: ITEMS_TABLE,
      Key: { itemId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();
    
    console.log('✅ Successfully updated item');
    
    res.status(200).json({
      success: true,
      message: 'Item updated successfully',
      data: result.Attributes
    });

  } catch (error) {
    console.error('❌ Error updating item:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating item',
      error: error.message
    });
  }
};

// Delete item
export const deleteItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    console.log(`📦 Deleting item: ${itemId}`);

    const params = {
      TableName: ITEMS_TABLE,
      Key: { itemId }
    };

    await dynamoDB.delete(params).promise();
    
    console.log('✅ Successfully deleted item');
    
    res.status(200).json({
      success: true,
      message: 'Item deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting item:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting item',
      error: error.message
    });
  }
};
