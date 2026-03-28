/**
 * Workflow Service: Business logic for workflow operations
 */

import * as WorkflowModel from '../models/DynamoWorkflow.js';
import * as WorkflowScheduler from './workflowScheduler.js';

/**
 * Create a new workflow
 */
export const createWorkflow = async (workflowData) => {
  if (!workflowData.workspaceId || !workflowData.name) {
    throw new Error('workspaceId and name are required');
  }

  return await WorkflowModel.createWorkflow(workflowData);
};

/**
 * Get workflow by ID
 */
export const getWorkflow = async (workflowId) => {
  const workflow = await WorkflowModel.getWorkflowById(workflowId);
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }
  return workflow;
};

/**
 * Get all workflows for a workspace
 */
export const getWorkflowsByWorkspace = async (workspaceId) => {
  return await WorkflowModel.getWorkflowsByWorkspaceId(workspaceId);
};

/**
 * Update a workflow
 */
export const updateWorkflow = async (workflowId, updateData, actionServices) => {
  const workflow = await WorkflowModel.getWorkflowById(workflowId);
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  // If triggers or enabled status changed, reschedule
  const hasScheduleChanges =
    updateData.triggers !== undefined ||
    updateData.isEnabled !== undefined ||
    updateData.actions !== undefined;

  const updated = await WorkflowModel.updateWorkflow(workflowId, updateData);

  if (hasScheduleChanges && actionServices) {
    await WorkflowScheduler.rescheduleWorkflow(workflowId, actionServices, null);
  }

  return updated;
};

/**
 * Delete a workflow
 */
export const deleteWorkflow = async (workflowId) => {
  // Unschedule any active jobs
  WorkflowScheduler.unscheduleWorkflow(workflowId);

  return await WorkflowModel.deleteWorkflow(workflowId);
};

/**
 * Enable a workflow
 */
export const enableWorkflow = async (workflowId, actionServices) => {
  await WorkflowModel.enableWorkflow(workflowId);
  await WorkflowScheduler.enableWorkflowSchedule(workflowId, actionServices, null);
  return { status: 'enabled' };
};

/**
 * Disable a workflow
 */
export const disableWorkflow = async (workflowId) => {
  await WorkflowModel.disableWorkflow(workflowId);
  WorkflowScheduler.disableWorkflowSchedule(workflowId);
  return { status: 'disabled' };
};

/**
 * Get execution history for a workflow
 */
export const getExecutionHistory = async (workflowId, limit = 100) => {
  const workflow = await WorkflowModel.getWorkflowById(workflowId);
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  return {
    workflowId,
    executionLog: (workflow.executionLog || []).slice(0, limit),
    totalExecutions: workflow.totalExecutions || 0,
    totalFailures: workflow.totalFailures || 0,
    lastExecutionAt: workflow.lastExecutionAt || null
  };
};

/**
 * Get execution statistics for a workflow
 */
export const getExecutionStats = async (workflowId) => {
  const workflow = await WorkflowModel.getWorkflowById(workflowId);
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const log = workflow.executionLog || [];
  const completedCount = log.filter((e) => e.status === 'completed').length;
  const failedCount = log.filter((e) => e.status === 'failed').length;

  return {
    workflowId,
    name: workflow.name,
    isEnabled: workflow.isEnabled,
    totalExecutions: workflow.totalExecutions || 0,
    totalFailures: workflow.totalFailures || 0,
    successRate: workflow.totalExecutions > 0 ? ((workflow.totalExecutions - workflow.totalFailures) / workflow.totalExecutions * 100).toFixed(2) + '%' : 'N/A',
    lastExecutionAt: workflow.lastExecutionAt,
    createdAt: workflow.createdAt
  };
};

/**
 * Validate workflow structure
 */
export const validateWorkflow = (workflowData) => {
  const errors = [];

  if (!workflowData.name || workflowData.name.trim() === '') {
    errors.push('Workflow name is required');
  }

  if (!workflowData.workspaceId) {
    errors.push('Workspace ID is required');
  }

  if (!workflowData.triggers || workflowData.triggers.length === 0) {
    errors.push('At least one trigger is required');
  } else {
    workflowData.triggers.forEach((trigger, idx) => {
      if (!trigger.type) {
        errors.push(`Trigger ${idx + 1} is missing type`);
      }
      if (!trigger.rule) {
        errors.push(`Trigger ${idx + 1} is missing rule`);
      }
    });
  }

  if (!workflowData.actions || workflowData.actions.length === 0) {
    errors.push('At least one action is required');
  } else {
    workflowData.actions.forEach((action, idx) => {
      if (!action.type) {
        errors.push(`Action ${idx + 1} is missing type`);
      }
      if (!action.params) {
        errors.push(`Action ${idx + 1} is missing parameters`);
      }
    });
  }

  if (workflowData.logicOperator && !['AND', 'OR'].includes(workflowData.logicOperator)) {
    errors.push('Invalid logic operator. Must be AND or OR');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Get webhook config for a workflow (creates one if absent)
 */
export const getWebhookConfig = async (workflowId, backendBaseUrl) => {
  const config = await WorkflowModel.getOrCreateWebhookConfig(workflowId);
  const workflow = await WorkflowModel.getWorkflowById(workflowId);

  return {
    workflowId,
    workflowName: workflow?.name || 'Workflow',
    secret: config.secret,
    hasSecret: Boolean(config.secret),
    triggerUrl: `${backendBaseUrl}/api/webhooks/workflows/${workflowId}/trigger`,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    rotatedAt: config.rotatedAt || null
  };
};

/**
 * Rotate webhook secret for workflow
 */
export const rotateWebhookConfigSecret = async (workflowId, backendBaseUrl) => {
  const config = await WorkflowModel.rotateWebhookSecret(workflowId);
  const workflow = await WorkflowModel.getWorkflowById(workflowId);

  return {
    workflowId,
    workflowName: workflow?.name || 'Workflow',
    secret: config.secret,
    hasSecret: Boolean(config.secret),
    triggerUrl: `${backendBaseUrl}/api/webhooks/workflows/${workflowId}/trigger`,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    rotatedAt: config.rotatedAt || null
  };
};

/**
 * Verify provided webhook secret header
 */
export const verifyWebhookSecret = async (workflowId, providedSecret) => {
  const workflow = await WorkflowModel.getWorkflowById(workflowId);
  if (!workflow) throw new Error('Workflow not found');

  const storedSecret = workflow.webhookConfig?.secret;
  if (!storedSecret) {
    throw new Error('Webhook secret is not configured for this workflow');
  }

  return String(providedSecret || '') === String(storedSecret);
};

/**
 * List webhook metadata by workspace
 */
export const listWorkspaceWebhookConfigs = async (workspaceId, backendBaseUrl) => {
  const list = await WorkflowModel.listWorkspaceWebhookConfigs(workspaceId);
  return list.map((item) => ({
    ...item,
    triggerUrl: `${backendBaseUrl}/api/webhooks/workflows/${item.workflowId}/trigger`
  }));
};

/**
 * List outbound webhook actions in workspace workflows
 */
export const listWorkspaceOutboundWebhooks = async (workspaceId) => {
  return WorkflowModel.listWorkspaceOutboundWebhooks(workspaceId);
};
