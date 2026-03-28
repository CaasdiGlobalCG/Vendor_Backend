import { dynamoDB } from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

import { WORKFLOWS_TABLE } from '../../../config/aws.js';

/**
 * Create a workflow in DynamoDB
 */
export const createWorkflow = async (workflowData) => {
  const workflowId = `WF-${uuidv4()}`;
  const createdAt = new Date().toISOString();

  const params = {
    TableName: WORKFLOWS_TABLE,
    Item: {
      workflowId, // PK
      workspaceId: workflowData.workspaceId, // SK or attribute for filtering
      name: workflowData.name,
      description: workflowData.description || '',
      isEnabled: workflowData.isEnabled !== false,
      
      // Triggers: array of rule objects
      triggers: workflowData.triggers || [],
      logicOperator: workflowData.logicOperator || 'AND', // AND or OR
      
      // Actions: ordered chain of action objects
      actions: workflowData.actions || [],
      
      // Execution history
      executionLog: [],
      lastExecutionAt: null,
      totalExecutions: 0,
      totalFailures: 0,
      
      // Metadata
      createdBy: workflowData.createdBy,
      createdAt,
      updatedAt: createdAt
    }
  };

  try {
    await dynamoDB.put(params).promise();
    console.log(`✅ Workflow created: ${workflowId}`);
    return params.Item;
  } catch (error) {
    console.error('❌ Error creating workflow:', error);
    throw error;
  }
};

/**
 * Get workflow by ID
 */
export const getWorkflowById = async (workflowId) => {
  const params = {
    TableName: WORKFLOWS_TABLE,
    Key: { workflowId },
    ConsistentRead: true
  };

  try {
    const result = await dynamoDB.get(params).promise();
    return result.Item || null;
  } catch (error) {
    console.error('❌ Error getting workflow:', error);
    throw error;
  }
};

/**
 * Get all workflows for a workspace
 */
export const getWorkflowsByWorkspaceId = async (workspaceId) => {
  const params = {
    TableName: WORKFLOWS_TABLE,
    FilterExpression: 'workspaceId = :workspaceId',
    ExpressionAttributeValues: {
      ':workspaceId': workspaceId
    }
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    return result.Items || [];
  } catch (error) {
    console.error('❌ Error getting workflows:', error);
    throw error;
  }
};

/**
 * Update workflow
 */
export const updateWorkflow = async (workflowId, updateData) => {
  const updatedAt = new Date().toISOString();
  
  // Build update expression dynamically
  const updateExpressionParts = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};
  let expressionIndex = 0;

  Object.keys(updateData).forEach((key) => {
    if (key === 'workflowId' || key === 'workspaceId') return; // Don't update keys
    
    const placeholder = `#${key}`;
    const valueKey = `:${key}`;
    updateExpressionParts.push(`${placeholder} = ${valueKey}`);
    expressionAttributeNames[placeholder] = key;
    expressionAttributeValues[valueKey] = updateData[key];
  });

  // Always update updatedAt
  updateExpressionParts.push(`#updatedAt = :updatedAt`);
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':updatedAt'] = updatedAt;

  const params = {
    TableName: WORKFLOWS_TABLE,
    Key: { workflowId },
    UpdateExpression: `SET ${updateExpressionParts.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW'
  };

  try {
    const result = await dynamoDB.update(params).promise();
    console.log(`✅ Workflow updated: ${workflowId}`);
    return result.Attributes;
  } catch (error) {
    console.error('❌ Error updating workflow:', error);
    throw error;
  }
};

/**
 * Delete workflow
 */
export const deleteWorkflow = async (workflowId) => {
  const params = {
    TableName: WORKFLOWS_TABLE,
    Key: { workflowId }
  };

  try {
    await dynamoDB.delete(params).promise();
    console.log(`✅ Workflow deleted: ${workflowId}`);
    return true;
  } catch (error) {
    console.error('❌ Error deleting workflow:', error);
    throw error;
  }
};

/**
 * Add execution log entry
 */
export const addExecutionLogEntry = async (workflowId, executionEntry) => {
  const workflow = await getWorkflowById(workflowId);
  if (!workflow) throw new Error('Workflow not found');

  const updatedLog = [executionEntry, ...(workflow.executionLog || [])].slice(0, 1000); // Keep last 1000 executions
  const totalExecutions = (workflow.totalExecutions || 0) + 1;
  const totalFailures = (workflow.totalFailures || 0) + (executionEntry.status === 'failed' ? 1 : 0);

  const params = {
    TableName: WORKFLOWS_TABLE,
    Key: { workflowId },
    UpdateExpression: 'SET executionLog = :log, lastExecutionAt = :lastExec, totalExecutions = :total, totalFailures = :failures, updatedAt = :updated',
    ExpressionAttributeValues: {
      ':log': updatedLog,
      ':lastExec': new Date().toISOString(),
      ':total': totalExecutions,
      ':failures': totalFailures,
      ':updated': new Date().toISOString()
    },
    ReturnValues: 'ALL_NEW'
  };

  try {
    const result = await dynamoDB.update(params).promise();
    return result.Attributes;
  } catch (error) {
    console.error('❌ Error adding execution log:', error);
    throw error;
  }
};

/**
 * Enable workflow
 */
export const enableWorkflow = async (workflowId) => {
  return updateWorkflow(workflowId, { isEnabled: true });
};

/**
 * Disable workflow
 */
export const disableWorkflow = async (workflowId) => {
  return updateWorkflow(workflowId, { isEnabled: false });
};

/**
 * Get or create webhook configuration for a workflow
 */
export const getOrCreateWebhookConfig = async (workflowId) => {
  const workflow = await getWorkflowById(workflowId);
  if (!workflow) throw new Error('Workflow not found');

  if (workflow.webhookConfig?.secret) {
    return workflow.webhookConfig;
  }

  const webhookConfig = {
    secret: crypto.randomBytes(24).toString('hex'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await updateWorkflow(workflowId, { webhookConfig });
  return webhookConfig;
};

/**
 * Rotate webhook secret for a workflow
 */
export const rotateWebhookSecret = async (workflowId) => {
  const workflow = await getWorkflowById(workflowId);
  if (!workflow) throw new Error('Workflow not found');

  const webhookConfig = {
    ...(workflow.webhookConfig || {}),
    secret: crypto.randomBytes(24).toString('hex'),
    updatedAt: new Date().toISOString(),
    rotatedAt: new Date().toISOString()
  };

  await updateWorkflow(workflowId, { webhookConfig });
  return webhookConfig;
};

/**
 * List webhook metadata for a workspace
 */
export const listWorkspaceWebhookConfigs = async (workspaceId) => {
  const workflows = await getWorkflowsByWorkspaceId(workspaceId);

  return workflows.map((workflow) => ({
    workflowId: workflow.workflowId,
    name: workflow.name,
    isEnabled: workflow.isEnabled !== false,
    hasWebhookSecret: Boolean(workflow.webhookConfig?.secret),
    webhookUpdatedAt: workflow.webhookConfig?.updatedAt || null
  }));
};

/**
 * List outbound webhook actions configured in workflows for workspace
 */
export const listWorkspaceOutboundWebhooks = async (workspaceId) => {
  const workflows = await getWorkflowsByWorkspaceId(workspaceId);

  const outbound = [];

  workflows.forEach((workflow) => {
    (workflow.actions || []).forEach((action) => {
      if (action.type === 'call-webhook') {
        outbound.push({
          workflowId: workflow.workflowId,
          workflowName: workflow.name,
          actionId: action.id,
          url: action.params?.url || '',
          method: action.params?.method || 'POST',
          parallelGroup: action.parallelGroup || null
        });
      }
    });
  });

  return outbound;
};
