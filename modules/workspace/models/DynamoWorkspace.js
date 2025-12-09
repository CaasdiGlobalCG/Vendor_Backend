import { dynamoDB, WORKSPACES_TABLE } from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

// Create a workspace in DynamoDB
export const createWorkspace = async (workspaceData) => {
  const id = uuidv4();
  const projectId = workspaceData.projectId || `PROJ-${Date.now()}`;
  const params = {
    TableName: WORKSPACES_TABLE,
    Item: {
      workspaceId: id, // Primary key
      id: id, // Legacy alias
      projectId, // Ensure PM table PK compatibility
      leadId: workspaceData.leadId, // Link to lead
      vendorId: workspaceData.vendorId, // Owner of the workspace
      title: workspaceData.title || `Workspace for ${workspaceData.leadId || workspaceData.projectId}`,
      description: workspaceData.description || '',

      // Workspace canvas data
      nodes: workspaceData.nodes || [], // ReactFlow nodes
      edges: workspaceData.edges || [], // ReactFlow edges
      layers: workspaceData.layers || [], // Layer structure
      zoomLevel: workspaceData.zoomLevel || 100,
      canvasSettings: workspaceData.canvasSettings || {},

      // Task management
      tasks: workspaceData.tasks || [], // Array of tasks with subtasks

      // Metadata
      status: workspaceData.status || 'active',
      isShared: workspaceData.isShared || false,
      sharedWith: workspaceData.sharedWith || [], // Array of user IDs who have access

      createdAt: new Date().toISOString(),
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
    console.error('Error creating workspace in DynamoDB:', error);
    throw error;
  }
};

// Internal: find a workspace by any of workspaceId | projectId | id
async function findWorkspaceByAnyId(anyId) {
  // Search in workspaces_table only
  const params = {
    TableName: WORKSPACES_TABLE,
    FilterExpression: '#wid = :id OR #pid = :id OR #id = :id',
    ExpressionAttributeNames: { '#wid': 'workspaceId', '#pid': 'projectId', '#id': 'id' },
    ExpressionAttributeValues: { ':id': anyId }
  };
  const result = await dynamoDB.scan(params).promise();
  return (result.Items && result.Items[0]) || null;
}

// Get a workspace by ID (flexible: accepts workspaceId/projectId/id)
export const getWorkspaceById = async (id) => {
  try {
    const item = await findWorkspaceByAnyId(id);
    if (item) {
      return { ...item, _id: item.workspaceId || item.projectId || item.id };
    }
    return null;
  } catch (error) {
    console.error('Error getting workspace by ID from DynamoDB:', error);
    throw error;
  }
};

// Get workspace by lead ID
export const getWorkspaceByLeadId = async (leadId) => {
  try {
    const params = {
      TableName: WORKSPACES_TABLE,
      FilterExpression: 'leadId = :leadId',
      ExpressionAttributeValues: { ':leadId': leadId }
    };
    const result = await dynamoDB.scan(params).promise();
    
    if (result.Items && result.Items.length > 0) {
      const workspace = result.Items[0]; // Get the first workspace for this lead
      return {
        ...workspace,
        _id: workspace.workspaceId // Add _id field for frontend compatibility
      };
    }

    return null;
  } catch (error) {
    console.error('Error getting workspace by lead ID from DynamoDB:', error);
    throw error;
  }
};

// Get workspace by project ID
export const getWorkspaceByProjectId = async (projectId) => {
  try {
    const params = {
      TableName: WORKSPACES_TABLE,
      FilterExpression: 'projectId = :projectId',
      ExpressionAttributeValues: { ':projectId': projectId }
    };
    const result = await dynamoDB.scan(params).promise();
    
    if (result.Items && result.Items.length > 0) {
      const workspace = result.Items[0]; // Get the first workspace for this project
      return {
        ...workspace,
        _id: workspace.workspaceId // Add _id field for frontend compatibility
      };
    }

    return null;
  } catch (error) {
    console.error('Error getting workspace by project ID from DynamoDB:', error);
    throw error;
  }
};

// Get workspaces by vendor ID
export const getWorkspacesByVendorId = async (vendorId) => {
  try {
    const params = {
      TableName: WORKSPACES_TABLE,
      FilterExpression: 'vendorId = :vendorId',
      ExpressionAttributeValues: { ':vendorId': vendorId }
    };
    const result = await dynamoDB.scan(params).promise();
    const workspaces = (result.Items || []).map(workspace => {
      return {
        ...workspace,
        _id: workspace.workspaceId // Add _id field for frontend compatibility
      };
    });
    return workspaces;
  } catch (error) {
    console.error('Error getting workspaces by vendor ID from DynamoDB:', error);
    throw error;
  }
};

// Update a workspace
// Helper to recursively remove undefined values
const removeUndefined = (obj) => {
  if (Array.isArray(obj)) {
    return obj.map(v => removeUndefined(v));
  } else if (obj !== null && typeof obj === 'object') {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = removeUndefined(value);
      }
      return acc;
    }, {});
  }
  return obj;
};

// Update a workspace
export const updateWorkspace = async (id, workspaceData) => {
  // Clean workspaceData of undefined values
  const cleanWorkspaceData = removeUndefined(workspaceData);

  console.log('🔄 DynamoDB: updateWorkspace called', {
    workspaceId: id,
    workspaceDataKeys: Object.keys(cleanWorkspaceData)
  });

  // First resolve the existing workspace (workspaceId | projectId | id)
  const existingWorkspace = await getWorkspaceById(id);

  if (!existingWorkspace) {
    console.error('❌ DynamoDB: Workspace not found for ID:', id);
    throw new Error('Workspace not found');
  }

  console.log('✅ DynamoDB: Found existing workspace', {
    workspaceId: id,
    title: existingWorkspace.title,
    leadId: existingWorkspace.leadId
  });

  // Prepare update expression and attribute values
  let updateExpression = 'set ';
  const expressionAttributeValues = {};
  const expressionAttributeNames = {};
  let isFirst = true;

  // Process each field in cleanWorkspaceData
  Object.entries(cleanWorkspaceData).forEach(([key, value]) => {
    // Skip id as it's the primary key
    if (key === 'id' || key === 'workspaceId') return;

    const attributeName = `#${key}`;
    const attributeValue = `:${key}`;

    expressionAttributeNames[attributeName] = key;
    expressionAttributeValues[attributeValue] = value;

    updateExpression += `${!isFirst ? ', ' : ''}${attributeName} = ${attributeValue}`;
    isFirst = false;
  });

  // Add updatedAt timestamp
  updateExpression += `${!isFirst ? ', ' : ''}#updatedAt = :updatedAt`;
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':updatedAt'] = new Date().toISOString();

  // Use workspaceId as the primary key for workspaces_table
  // The primary key for workspaces_table is workspaceId, so we must use that
  const workspaceId = existingWorkspace.workspaceId || existingWorkspace.id || id;
  
  if (!workspaceId) {
    throw new Error('Cannot update workspace: workspaceId is required');
  }

  console.log('🔑 DynamoDB: Using workspaceId as primary key:', workspaceId);
  console.log('📝 DynamoDB: Update expression:', updateExpression);
  console.log('📊 DynamoDB: Updating fields:', Object.keys(cleanWorkspaceData));
  console.log('📦 DynamoDB: Nodes count in update:', cleanWorkspaceData.nodes?.length || 0);
  if (cleanWorkspaceData.nodes?.length > 0) {
    console.log('📦 DynamoDB: First node sample:', JSON.stringify(cleanWorkspaceData.nodes[0], null, 2));
  }

  const params = {
    TableName: WORKSPACES_TABLE,
    Key: { workspaceId: workspaceId },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW'
  };

  try {
    console.log(`🔄 DynamoDB: Attempting update in workspaces_table with workspaceId:`, workspaceId);
    const result = await dynamoDB.update(params).promise();
    console.log(`✅ DynamoDB: Update successful in workspaces_table`);
    console.log('📊 DynamoDB: Result nodes count:', result.Attributes?.nodes?.length || 0);
    console.log('📊 DynamoDB: Result nodes type:', Array.isArray(result.Attributes?.nodes) ? 'Array' : typeof result.Attributes?.nodes);
    if (result.Attributes?.nodes?.length > 0) {
      console.log('📊 DynamoDB: First node from DB:', JSON.stringify(result.Attributes.nodes[0], null, 2));
    } else if (result.Attributes?.nodes !== undefined) {
      console.log('⚠️ DynamoDB: nodes field exists but is empty or not an array:', result.Attributes.nodes);
    }
    
    if (result.Attributes) {
      const updatedItem = { ...result.Attributes, _id: result.Attributes.workspaceId || result.Attributes.id || result.Attributes.projectId };
      console.log('✅ DynamoDB: Returning updated workspace with nodes count:', updatedItem.nodes?.length || 0);
      // Verify the nodes were actually saved
      if (updatedItem.nodes?.length !== cleanWorkspaceData.nodes?.length) {
        console.warn('⚠️ DynamoDB: Node count mismatch! Expected:', cleanWorkspaceData.nodes?.length, 'Got:', updatedItem.nodes?.length);
      }
      
      // Immediately verify by reading back from DB
      console.log('🔍 DynamoDB: Immediately verifying by reading back from DB...');
      try {
        const verifyParams = {
          TableName: WORKSPACES_TABLE,
          Key: { workspaceId: workspaceId }
        };
        const verifyResult = await dynamoDB.get(verifyParams).promise();
        if (verifyResult.Item) {
          console.log('🔍 DynamoDB: Verification - nodes count in DB:', verifyResult.Item.nodes?.length || 0);
          console.log('🔍 DynamoDB: Verification - nodes type:', Array.isArray(verifyResult.Item.nodes) ? 'Array' : typeof verifyResult.Item.nodes);
          if (verifyResult.Item.nodes?.length !== cleanWorkspaceData.nodes?.length) {
            console.error('❌ DynamoDB: VERIFICATION FAILED! Nodes not persisted!');
            console.error('❌ DynamoDB: Expected:', cleanWorkspaceData.nodes?.length, 'Got in DB:', verifyResult.Item.nodes?.length);
          } else {
            console.log('✅ DynamoDB: Verification passed - nodes persisted correctly!');
          }
        }
      } catch (verifyErr) {
        console.error('❌ DynamoDB: Error during immediate verification:', verifyErr.message);
      }
      
      return updatedItem;
    }
    throw new Error('Update succeeded but no attributes returned');
  } catch (err) {
    console.error(`❌ DynamoDB: Update failed in workspaces_table with workspaceId`, workspaceId, 'Error:', err.message);
    console.error('❌ DynamoDB: Error details:', JSON.stringify(err, null, 2));
    lastError = err;
    // Fall through to PUT fallback
  }

  // If update failed, try upsert via put in workspaces_table
  // This should not normally happen, but serves as a fallback
  try {
    const mergedItem = { ...existingWorkspace, ...cleanWorkspaceData };
    const upsertId = existingWorkspace.workspaceId || existingWorkspace.id || id;
    // Ensure workspaceId is set (primary key for workspaces_table)
    mergedItem.workspaceId = upsertId;
    mergedItem.id = upsertId;
    mergedItem.updatedAt = new Date().toISOString();
    
    console.log(`ℹ️ DynamoDB: Falling back to PUT operation with workspaceId:`, upsertId);
    console.log('📊 DynamoDB: Nodes count in PUT:', mergedItem.nodes?.length || 0);
    
    const putParams = { 
      TableName: WORKSPACES_TABLE, 
      Item: mergedItem 
    };
    await dynamoDB.put(putParams).promise();
    console.log(`✅ DynamoDB: PUT successful in workspaces_table with workspaceId`, upsertId);
    console.log('📊 DynamoDB: Upserted nodes count:', mergedItem.nodes?.length || 0);
    
    // Verify by reading back the item
    const verifyParams = {
      TableName: WORKSPACES_TABLE,
      Key: { workspaceId: upsertId }
    };
    const verifyResult = await dynamoDB.get(verifyParams).promise();
    if (verifyResult.Item) {
      console.log('✅ DynamoDB: Verified - nodes count in DB:', verifyResult.Item.nodes?.length || 0);
      return { ...verifyResult.Item, _id: verifyResult.Item.workspaceId || verifyResult.Item.id };
    }
    
    return { ...mergedItem, _id: mergedItem.workspaceId || mergedItem.id };
  } catch (putErr) {
    console.error('❌ DynamoDB: Put failed in workspaces_table:', putErr.message);
    console.error('❌ DynamoDB: Put error details:', JSON.stringify(putErr, null, 2));
    throw (lastError || putErr);
  }
};

// Delete a workspace
export const deleteWorkspace = async (id) => {
  // Resolve item first to determine PK
  const existing = await getWorkspaceById(id);
  if (!existing) return false;
  const key = existing.projectId ? { projectId: existing.projectId } : existing.id ? { id: existing.id } : { workspaceId: existing.workspaceId };
  const params = { TableName: WORKSPACES_TABLE, Key: key };

  try {
    await dynamoDB.delete(params).promise();
    return true;
  } catch (error) {
    console.error('Error deleting workspace from DynamoDB:', error);
    throw error;
  }
};

// Create or get workspace for a lead/project
export const createOrGetWorkspaceForLead = async (leadId, vendorId, projectId = null) => {
  try {
    // First try to get existing workspace
    let workspace = await getWorkspaceByLeadId(leadId);

    if (!workspace && projectId) {
      // If no workspace found by leadId, try by projectId
      workspace = await getWorkspaceByProjectId(projectId);
    }

    if (!workspace) {
      // Create new workspace if none exists
      const workspaceData = {
        leadId,
        projectId,
        vendorId,
        title: `Workspace for Lead ${leadId}`,
        description: `Collaborative workspace for lead/project management`,
        nodes: [],
        edges: [],
        layers: [
          {
            id: 1,
            name: 'Project Planning',
            type: 'folder',
            color: 'bg-blue-500',
            items: []
          },
          {
            id: 2,
            name: 'Resources',
            type: 'folder',
            color: 'bg-green-500',
            items: []
          }
        ],
        tasks: [], // Array of tasks for this workspace
        status: 'active'
      };

      workspace = await createWorkspace(workspaceData);
      console.log(`Created new workspace for lead ${leadId}:`, workspace.workspaceId);
    }

    return workspace;
  } catch (error) {
    console.error('Error creating or getting workspace for lead:', error);
    throw error;
  }
};

export { WORKSPACES_TABLE };
