import { dynamoDB, LEADS_TABLE } from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

// Create a lead in DynamoDB
export const createLead = async (leadData) => {
  const id = uuidv4();
  const params = {
    TableName: LEADS_TABLE,
    Item: {
      leadId: id, // Primary key
      id: id, // For compatibility
      ...leadData,
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
    console.error('Error creating lead in DynamoDB:', error);
    throw error;
  }
};

// Get a lead by ID
export const getLeadById = async (id) => {
  const params = {
    TableName: LEADS_TABLE,
    Key: {
      leadId: id
    }
  };

  try {
    const result = await dynamoDB.get(params).promise();
    if (result.Item) {
      return {
        ...result.Item,
        _id: result.Item.leadId // Add _id field for frontend compatibility
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting lead by ID from DynamoDB:', error);
    throw error;
  }
};

// Get all leads
export const getAllLeads = async () => {
  const params = {
    TableName: LEADS_TABLE
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    // Map the leadId field to _id for frontend compatibility
    const leads = (result.Items || []).map(lead => {
      return {
        ...lead,
        _id: lead.leadId // Add _id field for frontend compatibility
      };
    });
    return leads;
  } catch (error) {
    console.error('Error getting all leads from DynamoDB:', error);
    throw error;
  }
};

// Get leads by client ID
export const getLeadsByClientId = async (clientId) => {
  const params = {
    TableName: LEADS_TABLE,
    FilterExpression: 'clientId = :clientId',
    ExpressionAttributeValues: {
      ':clientId': clientId
    }
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    const leads = (result.Items || []).map(lead => {
      return {
        ...lead,
        _id: lead.leadId // Add _id field for frontend compatibility
      };
    });
    return leads;
  } catch (error) {
    console.error('Error getting leads by client ID from DynamoDB:', error);
    throw error;
  }
};

// Get leads by vendor ID
export const getLeadsByVendorId = async (vendorId) => {
  const params = {
    TableName: LEADS_TABLE,
    FilterExpression: 'assignedVendorId = :vendorId',
    ExpressionAttributeValues: {
      ':vendorId': vendorId
    }
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    const leads = (result.Items || []).map(lead => {
      return {
        ...lead,
        _id: lead.leadId // Add _id field for frontend compatibility
      };
    });
    return leads;
  } catch (error) {
    console.error('Error getting leads by vendor ID from DynamoDB:', error);
    throw error;
  }
};

// Get leads by PM ID
export const getLeadsByPmId = async (pmId) => {
  const params = {
    TableName: LEADS_TABLE,
    FilterExpression: 'sentByPmId = :pmId',
    ExpressionAttributeValues: {
      ':pmId': pmId
    }
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    const leads = (result.Items || []).map(lead => {
      return {
        ...lead,
        _id: lead.leadId // Add _id field for frontend compatibility
      };
    });
    return leads;
  } catch (error) {
    console.error('Error getting leads by PM ID from DynamoDB:', error);
    throw error;
  }
};

// Update a lead
export const updateLead = async (id, leadData) => {
  // First get the existing lead to ensure it exists
  const existingLead = await getLeadById(id);
  
  if (!existingLead) {
    throw new Error('Lead not found');
  }

  // Prepare update expression and attribute values
  let updateExpression = 'set ';
  const expressionAttributeValues = {};
  const expressionAttributeNames = {};

  // Process each field in leadData
  Object.entries(leadData).forEach(([key, value], index) => {
    // Skip id as it's the primary key
    if (key === 'id' || key === 'leadId') return;
    
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
    TableName: LEADS_TABLE,
    Key: {
      leadId: id
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
        _id: result.Attributes.leadId // Add _id field for frontend compatibility
      };
    }
    return null;
  } catch (error) {
    console.error('Error updating lead in DynamoDB:', error);
    throw error;
  }
};

// Delete a lead
export const deleteLead = async (id) => {
  const params = {
    TableName: LEADS_TABLE,
    Key: {
      leadId: id
    }
  };

  try {
    await dynamoDB.delete(params).promise();
    return true;
  } catch (error) {
    console.error('Error deleting lead from DynamoDB:', error);
    throw error;
  }
};