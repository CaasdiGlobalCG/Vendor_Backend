import { dynamoDB } from '../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

// Define the table name for Google users
const GOOGLE_USERS_TABLE = 'google_users';

// Create a Google user in DynamoDB
export const createGoogleUser = async (userData) => {
  const id = uuidv4();
  const params = {
    TableName: GOOGLE_USERS_TABLE,
    Item: {
      userId: id, // Primary key
      id: id, // For consistency with other models
      googleId: userData.googleId,
      cognitoId: userData.cognitoId || null,
      displayName: userData.displayName || '',
      email: userData.email,
      role: userData.role || 'vendor',
      status: userData.status || 'pending',
      hasFilledForm: userData.hasFilledForm || false,
      createdAt: new Date().toISOString()
    }
  };

  try {
    await dynamoDB.put(params).promise();
    return {
      ...params.Item,
      _id: id // Add _id field for frontend compatibility
    };
  } catch (error) {
    console.error('Error creating Google user in DynamoDB:', error);
    throw error;
  }
};

// Get a Google user by googleId
export const getGoogleUserByGoogleId = async (googleId) => {
  const params = {
    TableName: GOOGLE_USERS_TABLE,
    FilterExpression: 'googleId = :googleId',
    ExpressionAttributeValues: {
      ':googleId': googleId
    }
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    
    if (result.Items && result.Items.length > 0) {
      const user = result.Items[0];
      return {
        ...user,
        _id: user.userId // Add _id field for frontend compatibility
      };
    }

    return null;
  } catch (error) {
    console.error('Error getting Google user by googleId from DynamoDB:', error);
    throw error;
  }
};

// Get a Google user by email
export const getGoogleUserByEmail = async (email) => {
  if (!email) {
    console.error('No email provided to getGoogleUserByEmail');
    return null;
  }
  
  // Normalize email to lowercase for consistency
  const normalizedEmail = email.toLowerCase();
  
  const params = {
    TableName: GOOGLE_USERS_TABLE,
    FilterExpression: 'email = :email',
    ExpressionAttributeValues: {
      ':email': normalizedEmail
    }
  };

  console.log('Looking up user by email:', normalizedEmail);

  try {
    const result = await dynamoDB.scan(params).promise();
    
    if (result.Items && result.Items.length > 0) {
      const user = result.Items[0];
      console.log('Found user by email:', normalizedEmail);
      return {
        ...user,
        _id: user.userId // Add _id field for frontend compatibility
      };
    }

    console.log('No user found for email:', normalizedEmail);
    return null;
  } catch (error) {
    console.error('Error getting Google user by email from DynamoDB:', error);
    throw error;
  }
};

// Get a Google user by ID
export const getGoogleUserById = async (id) => {
  const params = {
    TableName: GOOGLE_USERS_TABLE,
    Key: {
      userId: id
    }
  };

  try {
    const result = await dynamoDB.get(params).promise();
    if (result.Item) {
      return {
        ...result.Item,
        _id: result.Item.userId // Add _id field for frontend compatibility
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting Google user by ID from DynamoDB:', error);
    throw error;
  }
};

// Update a Google user
export const updateGoogleUser = async (id, userData) => {
  // First get the existing user to ensure it exists
  const existingUser = await getGoogleUserById(id);
  
  if (!existingUser) {
    throw new Error('Google user not found');
  }

  // Prepare update expression and attribute values
  let updateExpression = 'set ';
  const expressionAttributeValues = {};
  const expressionAttributeNames = {};

  // Process each field in userData
  Object.entries(userData).forEach(([key, value], index) => {
    // Skip id as it's the primary key
    if (key === 'id' || key === 'userId') return;
    
    const attributeName = `#${key}`;
    const attributeValue = `:${key}`;
    
    expressionAttributeNames[attributeName] = key;
    expressionAttributeValues[attributeValue] = value;
    
    updateExpression += `${index !== 0 ? ', ' : ''}${attributeName} = ${attributeValue}`;
  });

  // Add updatedAt timestamp
  updateExpression += ', #updatedAt = :updatedAt';
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':updatedAt'] = new Date().toISOString();

  const params = {
    TableName: GOOGLE_USERS_TABLE,
    Key: {
      userId: id
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW'
  };

  try {
    const result = await dynamoDB.update(params).promise();
    if (result.Attributes) {
      return {
        ...result.Attributes,
        _id: result.Attributes.userId // Add _id field for frontend compatibility
      };
    }
    return null;
  } catch (error) {
    console.error('Error updating Google user in DynamoDB:', error);
    throw error;
  }
};

// Get all Google users
export const getAllGoogleUsers = async () => {
  const params = {
    TableName: GOOGLE_USERS_TABLE
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    // Map the userId field to _id for frontend compatibility
    const users = (result.Items || []).map(user => {
      return {
        ...user,
        _id: user.userId // Add _id field for frontend compatibility
      };
    });
    return users;
  } catch (error) {
    console.error('Error getting all Google users from DynamoDB:', error);
    throw error;
  }
};

// Delete a Google user
export const deleteGoogleUser = async (id) => {
  const params = {
    TableName: GOOGLE_USERS_TABLE,
    Key: {
      userId: id
    }
  };

  try {
    await dynamoDB.delete(params).promise();
    return true;
  } catch (error) {
    console.error('Error deleting Google user from DynamoDB:', error);
    throw error;
  }
};

export { GOOGLE_USERS_TABLE };