import { dynamoDB } from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

// Define the table name for project leads
const PROJECT_LEADS_TABLE = 'project_leads';

// Create a project lead in DynamoDB
export const createProjectLead = async (leadData) => {
  const id = leadData.leadId || uuidv4();
  const params = {
    TableName: PROJECT_LEADS_TABLE,
    Item: {
      leadId: id, // Primary key
      name: leadData.name,
      clientId: leadData.clientId,
      description: leadData.description,
      duration: leadData.duration || null,
      budget: leadData.budget || null,
      sentByPmId: leadData.sentByPmId,
      assignedVendorId: leadData.assignedVendorId,
      boqFileName: leadData.boqFileName || null,
      boqFileUrl: leadData.boqFileUrl || null,
      quotationFileName: leadData.quotationFileName || null,
      quotationFileUrl: leadData.quotationFileUrl || null,
      status: leadData.status || 'new',
      createdAt: leadData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };

  try {
    await dynamoDB.put(params).promise();
    return {
      ...params.Item,
      _id: id // Add _id field for frontend compatibility
    };
  } catch (error) {
    console.error('Error creating project lead in DynamoDB:', error);
    throw error;
  }
};

// Get a project lead by ID
export const getProjectLeadById = async (id) => {
  const params = {
    TableName: PROJECT_LEADS_TABLE,
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
    console.error('Error getting project lead by ID from DynamoDB:', error);
    throw error;
  }
};

// Get all project leads
export const getAllProjectLeads = async () => {
  const params = {
    TableName: PROJECT_LEADS_TABLE
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
    console.error('Error getting all project leads from DynamoDB:', error);
    throw error;
  }
};

// Get project leads by vendor ID
export const getProjectLeadsByVendorId = async (vendorId) => {
  const params = {
    TableName: PROJECT_LEADS_TABLE,
    FilterExpression: 'assignedVendorId = :vendorId',
    ExpressionAttributeValues: {
      ':vendorId': vendorId
    }
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
    console.error(`Error getting project leads by vendor ID ${vendorId} from DynamoDB:`, error);
    throw error;
  }
};

// Update a project lead
export const updateProjectLead = async (id, leadData) => {
  // First get the existing lead to ensure it exists
  const existingLead = await getProjectLeadById(id);
  
  if (!existingLead) {
    throw new Error('Project lead not found');
  }

  // Prepare update expression and attribute values
  let updateExpression = 'set ';
  const expressionAttributeValues = {};
  const expressionAttributeNames = {};

  // Process each field in leadData
  Object.entries(leadData).forEach(([key, value], index) => {
    // Skip id as it's the primary key
    if (key === 'leadId') return;
    
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
    TableName: PROJECT_LEADS_TABLE,
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
    console.error('Error updating project lead in DynamoDB:', error);
    throw error;
  }
};

// Delete a project lead
export const deleteProjectLead = async (id) => {
  const params = {
    TableName: PROJECT_LEADS_TABLE,
    Key: {
      leadId: id
    }
  };

  try {
    await dynamoDB.delete(params).promise();
    return true;
  } catch (error) {
    console.error('Error deleting project lead from DynamoDB:', error);
    throw error;
  }
};

export { PROJECT_LEADS_TABLE };