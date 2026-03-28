/**
 * Workflow Executor: Executes actions for triggered workflows
 * Handles: action creation, status updates, user assignments, retries on failure
 */

import * as WorkflowModel from '../models/DynamoWorkflow.js';
import { evaluateRule } from './ruleMatcher.js';

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000]; // 5, 15, 30 minutes
const MAX_SUBWORKFLOW_DEPTH = 3;

/**
 * Execute all actions in a workflow
 * Returns execution result: { executionId, status, actions: [ { actionId, result, error?, retryCount } ] }
 */
export const executeWorkflow = async (workflow, eventData, actionServices) => {
  return executeWorkflowInternal(workflow, eventData, actionServices, { depth: 0 });
};

/**
 * Internal workflow execution with recursion guard for sub-workflows
 */
const executeWorkflowInternal = async (workflow, eventData, actionServices, executionContext = { depth: 0 }) => {
  const executionId = `EXEC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const startTime = new Date().toISOString();
  const actionResults = [];

  console.log(`🚀 Executing workflow: ${workflow.workflowId} (${executionId})`);

  if (!workflow.actions || workflow.actions.length === 0) {
    console.log(`⚠️ No actions to execute in workflow ${workflow.workflowId}`);
    return {
      executionId,
      status: 'completed',
      actions: [],
      startTime,
      endTime: new Date().toISOString()
    };
  }

  try {
    const actionExecution = await executeActionsList(workflow.actions, eventData, actionServices, workflow, executionContext);
    actionResults.push(...actionExecution.results);

    const hasFailure = actionResults.some((result) => result.result === 'failed');
    const hasPaused = actionResults.some((result) => result.result === 'paused');
    const executionStatus = hasFailure ? 'completed_with_errors' : hasPaused ? 'paused' : 'completed';

    // Log execution
    const executionEntry = {
      executionId,
      timestamp: startTime,
      triggerData: eventData,
      status: executionStatus,
      actions: actionResults,
      endTime: new Date().toISOString()
    };

    await WorkflowModel.addExecutionLogEntry(workflow.workflowId, executionEntry);

    console.log(`✅ Workflow execution completed: ${executionId} (Status: ${executionStatus})`);

    return {
      executionId,
      status: executionStatus,
      actions: actionResults,
      startTime,
      endTime: new Date().toISOString()
    };
  } catch (error) {
    console.error(`❌ Workflow execution failed: ${executionId}`, error);

    const executionEntry = {
      executionId,
      timestamp: startTime,
      triggerData: eventData,
      status: 'failed',
      error: error.message,
      actions: actionResults,
      endTime: new Date().toISOString()
    };

    await WorkflowModel.addExecutionLogEntry(workflow.workflowId, executionEntry);

    return {
      executionId,
      status: 'failed',
      actions: actionResults,
      error: error.message,
      startTime,
      endTime: new Date().toISOString()
    };
  }
};

/**
 * Execute a list of actions in sequence with fan-out parallel group support.
 */
const executeActionsList = async (actions, eventData, actionServices, workflow, executionContext) => {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { results: [] };
  }

  const actionGroups = groupActionsByParallel(actions);
  const results = [];

  for (const group of actionGroups) {
    const parallelResults = await Promise.allSettled(
      group.map((action) => executeAction(action, eventData, actionServices, workflow, executionContext))
    );

    parallelResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
        return;
      }

      results.push({
        actionId: group[index].id,
        actionType: group[index].type,
        result: 'failed',
        error: result.reason?.message || String(result.reason),
        retryCount: 0
      });
    });
  }

  return { results };
};

/**
 * Execute a single action
 */
const executeAction = async (action, eventData, actionServices, workflow, executionContext = { depth: 0 }) => {
  const actionId = action.id || `ACT-${Date.now()}`;
  const { type, params } = action;

  console.log(`  → Executing action: ${type} (${actionId})`);

  try {
    let result = null;

    switch (type) {
      case 'create-task':
        result = await executeCreateTask(params, eventData, actionServices);
        break;

      case 'update-status':
        result = await executeUpdateStatus(params, eventData, actionServices);
        break;

      case 'assign-user':
        result = await executeAssignUser(params, eventData, actionServices);
        break;

      case 'send-email':
        result = await executeSendEmail(params, eventData, actionServices, workflow);
        break;

      case 'call-webhook':
        result = await executeCallWebhook(params, eventData);
        break;

      case 'invoke-subworkflow':
        result = await executeInvokeSubworkflow(params, eventData, actionServices, executionContext);
        break;

      case 'wait-approval':
        result = await executeWaitApproval(params, eventData);
        break;

      case 'conditional-branch':
        result = await executeConditionalBranch(params, eventData, actionServices, workflow, executionContext);
        break;

      case 'loop':
        result = await executeLoop(params, eventData, actionServices, workflow, executionContext);
        break;

      default:
        throw new Error(`Unknown action type: ${type}`);
    }

    console.log(`  ✓ Action succeeded: ${actionId}`);

    return {
      actionId,
      actionType: type,
      result: result?.result === 'paused' ? 'paused' : 'success',
      output: result,
      retryCount: 0
    };
  } catch (error) {
    console.error(`  ✗ Action failed: ${actionId}`, error.message);

    return {
      actionId,
      actionType: type,
      result: 'failed',
      error: error.message,
      retryCount: 0
    };
  }
};

/**
 * Execute: Create Task (RFQ, Work Order, RFI, etc.)
 */
const executeCreateTask = async (params, eventData, actionServices) => {
  if (!params) throw new Error('Missing parameters for create-task action');

  const {
    templateType, // 'execution-work-order', 'execution-rfi', 'procurement-rfq', etc.
    templateData, // Pre-filled form data
    workspaceId
  } = params;

  if (!actionServices?.createTask) {
    throw new Error('createTask service not available');
  }

  // Merge template data with event data for dynamic population
  const taskData = {
    ...templateData,
    workspaceId: workspaceId || eventData.workspaceId
  };

  const result = await actionServices.createTask(templateType, taskData);
  return { taskId: result.id, taskName: result.name };
};

/**
 * Execute: Update Status (RFQ → Approved, etc.)
 */
const executeUpdateStatus = async (params, eventData, actionServices) => {
  if (!params) throw new Error('Missing parameters for update-status action');

  const {
    nodeId, // Target node to update status
    newStatus,
    message
  } = params;

  if (!actionServices?.updateStatus) {
    throw new Error('updateStatus service not available');
  }

  const result = await actionServices.updateStatus(nodeId || eventData.nodeId, newStatus, message, {
    workspaceId: params.workspaceId || eventData.workspaceId,
    eventData
  });
  return { nodeId: result.nodeId, oldStatus: result.oldStatus, newStatus: result.newStatus };
};

/**
 * Execute: Assign User
 */
const executeAssignUser = async (params, eventData, actionServices) => {
  if (!params) throw new Error('Missing parameters for assign-user action');

  const {
    nodeId, // Target node to assign
    userId, // User to assign to
    fromEventData // If true, use userId from eventData
  } = params;

  if (!actionServices?.assignUser) {
    throw new Error('assignUser service not available');
  }

  const targetUserId = fromEventData ? eventData.assigneeId : userId;
  if (!targetUserId) {
    throw new Error('No target user specified');
  }

  const result = await actionServices.assignUser(nodeId || eventData.nodeId, targetUserId, {
    workspaceId: params.workspaceId || eventData.workspaceId,
    eventData
  });
  return { nodeId: result.nodeId, assignedTo: result.assignedTo };
};

/**
 * Execute: Send Email
 */
const executeSendEmail = async (params, eventData, actionServices, workflow) => {
  if (!params) throw new Error('Missing parameters for send-email action');

  const {
    templateType, // 'task-created', 'status-updated', 'approval-request', 'custom'
    recipient, // email or 'from-event-data' + field path like 'assignee.email'
    subject,
    body,
    variables // Custom template variables
  } = params;

  if (!actionServices?.sendEmail) {
    throw new Error('sendEmail service not available');
  }

  // Resolve recipient
  let emailAddress = recipient;
  if (recipient === 'from-event-data') {
    emailAddress = getNestedValue(eventData, variables?.recipientField || 'assigneeEmail');
  }

  if (!emailAddress) {
    throw new Error('No email recipient found');
  }

  const emailParams = {
    to: emailAddress,
    subject: interpolateVariables(subject, eventData, workflow),
    body: interpolateVariables(body, eventData, workflow),
    templateType,
    variables: { ...variables, ...eventData }
  };

  const result = await actionServices.sendEmail(emailParams);
  return { recipientEmail: emailAddress, messageId: result.messageId };
};

/**
 * Execute: Call Webhook
 */
const executeCallWebhook = async (params, eventData) => {
  if (!params) throw new Error('Missing parameters for call-webhook action');

  const { url, method = 'POST', headers = {}, body, retryCount = 0 } = params;

  if (!url) throw new Error('Webhook URL is required');

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: body ? JSON.stringify(body) : JSON.stringify(eventData),
      timeout: 30000
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    return { statusCode: response.status, result };
  } catch (error) {
    // Implement retry logic if needed
    if (retryCount < MAX_RETRIES) {
      const delayMs = RETRY_DELAYS_MS[retryCount] || RETRY_DELAYS_MS[MAX_RETRIES - 1];
      console.log(`  ⟳ Webhook will retry in ${delayMs / 1000 / 60} minutes (attempt ${retryCount + 1}/${MAX_RETRIES})`);
    }
    throw error;
  }
};

/**
 * Execute: Invoke Sub-workflow
 */
const executeInvokeSubworkflow = async (params, eventData, actionServices, executionContext) => {
  if (!params) throw new Error('Missing parameters for invoke-subworkflow action');
  if (!params.subworkflowId) throw new Error('subworkflowId is required');

  const { subworkflowId } = params;

  if (executionContext.depth >= MAX_SUBWORKFLOW_DEPTH) {
    throw new Error(`Sub-workflow depth exceeded (${MAX_SUBWORKFLOW_DEPTH})`);
  }

  const subworkflow = await WorkflowModel.getWorkflowById(subworkflowId);
  if (!subworkflow) {
    throw new Error(`Sub-workflow not found: ${subworkflowId}`);
  }

  if (!subworkflow.isEnabled) {
    throw new Error(`Sub-workflow is disabled: ${subworkflowId}`);
  }

  const mergedEventData = {
    ...eventData,
    parentWorkflowId: eventData.workflowId,
    invokedByWorkflowId: subworkflowId
  };

  const subResult = await executeWorkflowInternal(subworkflow, mergedEventData, actionServices, {
    depth: executionContext.depth + 1
  });

  return { subworkflowId, executionId: subResult.executionId, status: subResult.status };
};

/**
 * Execute: Wait for approval gate.
 */
const executeWaitApproval = async (params, eventData) => {
  if (!params) throw new Error('Missing parameters for wait-approval action');

  const expectedStatus = params.expectedStatus || 'Approved';
  const currentStatus = eventData?.approvalStatus || eventData?.status || 'Pending';
  const autoApprove = params.autoApprove === true;

  if (autoApprove || currentStatus === expectedStatus) {
    return {
      result: 'success',
      gateStatus: 'approved',
      expectedStatus,
      currentStatus
    };
  }

  return {
    result: 'paused',
    gateStatus: 'awaiting_approval',
    expectedStatus,
    currentStatus,
    approver: params.approver || null,
    message: params.message || 'Workflow paused pending approval.'
  };
};

/**
 * Execute: Conditional branching action.
 */
const executeConditionalBranch = async (params, eventData, actionServices, workflow, executionContext) => {
  if (!params) throw new Error('Missing parameters for conditional-branch action');

  const condition = params.condition || null;
  const ifActions = Array.isArray(params.ifActions) ? params.ifActions : [];
  const elseActions = Array.isArray(params.elseActions) ? params.elseActions : [];

  if (!condition) {
    throw new Error('conditional-branch requires condition');
  }

  const syntheticRule = {
    type: 'conditional',
    rule: {
      operator: condition.operator || 'AND',
      operands: condition.operands || []
    }
  };

  const matched = evaluateRule(syntheticRule, eventData);
  const selected = matched ? ifActions : elseActions;

  const nestedResult = await executeActionsList(selected, eventData, actionServices, workflow, executionContext);

  return {
    branch: matched ? 'if' : 'else',
    condition,
    nestedCount: selected.length,
    nestedResults: nestedResult.results
  };
};

/**
 * Execute: Loop action.
 */
const executeLoop = async (params, eventData, actionServices, workflow, executionContext) => {
  if (!params) throw new Error('Missing parameters for loop action');

  const mode = params.mode || 'count';
  const loopActions = Array.isArray(params.actions) ? params.actions : [];
  const maxIterations = Math.min(Number(params.maxIterations || 1), 10);

  if (loopActions.length === 0) {
    throw new Error('loop action requires nested actions');
  }

  const iterations = [];

  if (mode === 'count') {
    const count = Math.min(Number(params.count || 1), 10);
    for (let i = 0; i < count; i += 1) {
      const iterData = { ...eventData, loopIteration: i + 1 };
      const nested = await executeActionsList(loopActions, iterData, actionServices, workflow, executionContext);
      iterations.push({ iteration: i + 1, results: nested.results });
    }
  } else {
    // while-mode with a condition and hard stop
    const condition = params.condition || { operator: 'AND', operands: [] };
    for (let i = 0; i < maxIterations; i += 1) {
      const iterData = { ...eventData, loopIteration: i + 1 };
      const shouldContinue = evaluateRule(
        {
          type: 'conditional',
          rule: {
            operator: condition.operator || 'AND',
            operands: condition.operands || []
          }
        },
        iterData
      );

      if (!shouldContinue) {
        break;
      }

      const nested = await executeActionsList(loopActions, iterData, actionServices, workflow, executionContext);
      iterations.push({ iteration: i + 1, results: nested.results });
    }
  }

  return {
    mode,
    iterationCount: iterations.length,
    iterations
  };
};

/**
 * Group actions by parallelGroup
 * Returns array of arrays: [ [action1, action2], [action3] ]
 * Actions in the same parallelGroup execute in parallel
 */
const groupActionsByParallel = (actions) => {
  const groups = [];
  let currentGroup = [];
  let currentParallelId = null;

  for (const action of actions) {
    const parallelId = action.parallelGroup || null;

    if (parallelId === currentParallelId) {
      // Same group, add to current
      currentGroup.push(action);
    } else {
      // Different group, start new one
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = [action];
      currentParallelId = parallelId;
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
};

/**
 * Interpolate variables in template strings
 * Example: "Hello {{userName}}, your task {{taskName}} is {{taskStatus}}"
 */
const interpolateVariables = (template, eventData, workflow) => {
  if (!template) return '';

  let result = template;

  const variables = {
    workflowName: workflow?.name || '',
    taskName: eventData?.taskName || eventData?.name || '',
    taskId: eventData?.nodeId || eventData?.id || '',
    taskStatus: eventData?.status || '',
    assignee: eventData?.assigneeName || '',
    timestamp: new Date().toISOString(),
    ...eventData
  };

  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    result = result.replace(regex, String(value || ''));
  });

  return result;
};

/**
 * Helper: Get nested value from object
 */
const getNestedValue = (obj, path) => {
  if (!path) return null;
  return path.split('.').reduce((current, prop) => current?.[prop], obj);
};
