import { dynamoDB, PROJECTS_TABLE } from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

// Create a project in DynamoDB
export const createProject = async (projectData) => {
  const id = uuidv4();
  const params = {
    TableName: PROJECTS_TABLE,
    Item: {
      projectId: id, // Primary key
      id: id, // For compatibility
      ...projectData,
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
    console.error('Error creating project in DynamoDB:', error);
    throw error;
  }
};

// Get a project by ID
export const getProjectById = async (id) => {
  const params = {
    TableName: PROJECTS_TABLE,
    Key: {
      projectId: id
    }
  };

  try {
    const result = await dynamoDB.get(params).promise();
    if (result.Item) {
      return {
        ...result.Item,
        _id: result.Item.projectId // Add _id field for frontend compatibility
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting project by ID from DynamoDB:', error);
    throw error;
  }
};

// Get all projects
export const getAllProjects = async () => {
  const params = {
    TableName: PROJECTS_TABLE
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    return result.Items.map(item => ({
      ...item,
      _id: item.projectId // Add _id field for frontend compatibility
    }));
  } catch (error) {
    console.error('Error getting all projects from DynamoDB:', error);
    throw error;
  }
};

// Get projects by vendor ID
export const getProjectsByVendorId = async (vendorId) => {
  const params = {
    TableName: PROJECTS_TABLE,
    FilterExpression: 'vendorId = :vendorId',
    ExpressionAttributeValues: {
      ':vendorId': vendorId
    }
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    return result.Items.map(item => ({
      ...item,
      _id: item.projectId // Add _id field for frontend compatibility
    }));
  } catch (error) {
    console.error('Error getting projects by vendor ID from DynamoDB:', error);
    throw error;
  }
};

// Get projects by client ID
export const getProjectsByClientId = async (clientId) => {
  const params = {
    TableName: PROJECTS_TABLE,
    FilterExpression: 'clientId = :clientId',
    ExpressionAttributeValues: {
      ':clientId': clientId
    }
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    return result.Items.map(item => ({
      ...item,
      _id: item.projectId // Add _id field for frontend compatibility
    }));
  } catch (error) {
    console.error('Error getting projects by client ID from DynamoDB:', error);
    throw error;
  }
};

// Update a project
export const updateProject = async (id, updateData) => {
  // Build the update expression and attribute values
  let updateExpression = 'set';
  const expressionAttributeValues = {};
  const expressionAttributeNames = {};

  Object.entries(updateData).forEach(([key, value], index) => {
    // Skip the id and projectId fields
    if (key === 'id' || key === 'projectId' || key === '_id') return;

    const attributeValueKey = `:val${index}`;
    const attributeNameKey = `#attr${index}`;

    updateExpression += ` ${attributeNameKey} = ${attributeValueKey},`;
    expressionAttributeValues[attributeValueKey] = value;
    expressionAttributeNames[attributeNameKey] = key;
  });

  // Remove the trailing comma
  updateExpression = updateExpression.slice(0, -1);

  // Add updatedAt timestamp
  updateExpression += ', #updatedAt = :updatedAt';
  expressionAttributeValues[':updatedAt'] = new Date().toISOString();
  expressionAttributeNames['#updatedAt'] = 'updatedAt';

  const params = {
    TableName: PROJECTS_TABLE,
    Key: {
      projectId: id
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ExpressionAttributeNames: expressionAttributeNames,
    ReturnValues: 'ALL_NEW'
  };

  try {
    const result = await dynamoDB.update(params).promise();
    return {
      ...result.Attributes,
      _id: result.Attributes.projectId // Add _id field for frontend compatibility
    };
  } catch (error) {
    console.error('Error updating project in DynamoDB:', error);
    throw error;
  }
};

// Delete a project
export const deleteProject = async (id) => {
  const params = {
    TableName: PROJECTS_TABLE,
    Key: {
      projectId: id
    }
  };

  try {
    await dynamoDB.delete(params).promise();
    return { success: true };
  } catch (error) {
    console.error('Error deleting project from DynamoDB:', error);
    throw error;
  }
};