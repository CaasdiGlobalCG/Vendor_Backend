import { dynamoDB, PM_PROJECTS_TABLE } from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

// Create a PM project in DynamoDB
export const createPMProject = async (projectData) => {
  const id = uuidv4();
  const now = new Date().toISOString();
  
  const params = {
    TableName: PM_PROJECTS_TABLE,
    Item: {
      id: id, // Primary key
      projectId: id, // For compatibility
      name: projectData.name || 'Untitled Project',
      description: projectData.description || '',
      status: projectData.status || 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: projectData.createdBy || projectData.vendorId,
      vendorId: projectData.vendorId,
      clientId: projectData.clientId,
      leadId: projectData.leadId, // Reference to the original lead
      lastUpdateNote: projectData.lastUpdateNote || 'Project created from approved lead',
      
      // Initialize empty task structure
      tasks: [],
      
      // Initialize empty kanban state
      kanbanState: {
        todo: [],
        inprogress: [],
        completed: []
      },
      
      // Add any additional fields from projectData
      ...projectData,
      
      // Ensure these fields are not overwritten
      id: id,
      createdAt: now,
      updatedAt: now
    }
  };

  try {
    console.log('🚀 DynamoPMProject: Creating PM project:', {
      id,
      name: projectData.name,
      vendorId: projectData.vendorId,
      leadId: projectData.leadId
    });
    
    await dynamoDB.put(params).promise();
    
    console.log('✅ DynamoPMProject: PM project created successfully');
    
    return {
      ...params.Item,
      _id: id // Add _id field for frontend compatibility
    };
  } catch (error) {
    console.error('❌ DynamoPMProject: Error creating PM project:', error);
    throw error;
  }
};

// Get a PM project by ID
export const getPMProjectById = async (id) => {
  const params = {
    TableName: PM_PROJECTS_TABLE,
    Key: {
      id: id
    }
  };

  try {
    const result = await dynamoDB.get(params).promise();
    if (result.Item) {
      return {
        ...result.Item,
        _id: result.Item.id // Add _id field for frontend compatibility
      };
    }
    return null;
  } catch (error) {
    console.error('❌ DynamoPMProject: Error getting PM project by ID:', error);
    throw error;
  }
};

// Get all PM projects
export const getAllPMProjects = async () => {
  const params = {
    TableName: PM_PROJECTS_TABLE
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    return (result.Items || []).map(item => ({
      ...item,
      _id: item.id // Add _id field for frontend compatibility
    }));
  } catch (error) {
    console.error('❌ DynamoPMProject: Error getting all PM projects:', error);
    throw error;
  }
};

// Get PM projects by vendor ID
export const getPMProjectsByVendorId = async (vendorId) => {
  const params = {
    TableName: PM_PROJECTS_TABLE,
    FilterExpression: 'vendorId = :vendorId',
    ExpressionAttributeValues: {
      ':vendorId': vendorId
    }
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    return (result.Items || []).map(item => ({
      ...item,
      _id: item.id // Add _id field for frontend compatibility
    }));
  } catch (error) {
    console.error('❌ DynamoPMProject: Error getting PM projects by vendor ID:', error);
    throw error;
  }
};

// Get PM projects by client ID
export const getPMProjectsByClientId = async (clientId) => {
  const params = {
    TableName: PM_PROJECTS_TABLE,
    FilterExpression: 'clientId = :clientId',
    ExpressionAttributeValues: {
      ':clientId': clientId
    }
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    return (result.Items || []).map(item => ({
      ...item,
      _id: item.id // Add _id field for frontend compatibility
    }));
  } catch (error) {
    console.error('❌ DynamoPMProject: Error getting PM projects by client ID:', error);
    throw error;
  }
};

// Get PM project by lead ID
export const getPMProjectByLeadId = async (leadId) => {
  const params = {
    TableName: PM_PROJECTS_TABLE,
    FilterExpression: 'leadId = :leadId',
    ExpressionAttributeValues: {
      ':leadId': leadId
    }
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    if (result.Items && result.Items.length > 0) {
      return {
        ...result.Items[0],
        _id: result.Items[0].id // Add _id field for frontend compatibility
      };
    }
    return null;
  } catch (error) {
    console.error('❌ DynamoPMProject: Error getting PM project by lead ID:', error);
    throw error;
  }
};

// Update a PM project
export const updatePMProject = async (id, updateData) => {
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
    TableName: PM_PROJECTS_TABLE,
    Key: {
      id: id
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
      _id: result.Attributes.id // Add _id field for frontend compatibility
    };
  } catch (error) {
    console.error('❌ DynamoPMProject: Error updating PM project:', error);
    throw error;
  }
};

// Delete a PM project
export const deletePMProject = async (id) => {
  const params = {
    TableName: PM_PROJECTS_TABLE,
    Key: {
      id: id
    }
  };

  try {
    await dynamoDB.delete(params).promise();
    return { success: true };
  } catch (error) {
    console.error('❌ DynamoPMProject: Error deleting PM project:', error);
    throw error;
  }
};

export { PM_PROJECTS_TABLE };
