import AWS from 'aws-sdk';
import dotenv from 'dotenv';

dotenv.config();

const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION,
});

const TABLE_NAME = 'Assets';

// Create a new asset record
export const createAsset = async (assetData) => {
  const params = {
    TableName: TABLE_NAME,
    Item: {
      ...assetData,
      createdAt: new Date().toISOString(),
    },
  };

  try {
    await dynamodb.put(params).promise();
    return assetData;
  } catch (error) {
    console.error('Error creating asset:', error);
    throw error;
  }
};

// Get all assets for a subtask
export const getSubtaskAssets = async (workspaceId, subtaskId) => {
  const params = {
    TableName: TABLE_NAME,
    IndexName: 'subtaskIdIndex',
    KeyConditionExpression: 'subtaskId = :sid',
    ExpressionAttributeValues: {
      ':sid': subtaskId,
    },
  };

  try {
    const result = await dynamodb.query(params).promise();
    
    // Group assets by category
    const assets = {
      images: [],
      documents: [],
      icons: [],
      fonts: []
    };

    result.Items?.forEach(item => {
      const category = item.category;
      if (assets[category]) {
        assets[category].push(item);
      }
    });

    return assets;
  } catch (error) {
    console.error('Error fetching assets:', error);
    return {
      images: [],
      documents: [],
      icons: [],
      fonts: []
    };
  }
};

// Delete asset record
export const deleteAssetRecord = async (workspaceId, assetId) => {
  const params = {
    TableName: TABLE_NAME,
    Key: {
      workspaceId,
      assetId,
    },
  };

  try {
    await dynamodb.delete(params).promise();
    return true;
  } catch (error) {
    console.error('Error deleting asset record:', error);
    throw error;
  }
};

export default {
  createAsset,
  getSubtaskAssets,
  deleteAssetRecord,
};
