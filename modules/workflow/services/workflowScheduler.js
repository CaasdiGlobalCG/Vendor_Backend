/**
 * Workflow Scheduler: Polls for triggers and evaluates workflows
 * - Time-based triggers: Cron jobs
 * - Event-based triggers: Listen to canvas events (status changes, approvals, etc.)
 */

import cron from 'node-cron';
import * as WorkflowModel from '../models/DynamoWorkflow.js';
import * as RuleMatcher from './ruleMatcher.js';
import * as WorkflowExecutor from './workflowExecutor.js';

let cronJobs = new Map(); // Store active cron jobs by workflowId
let eventListener = null; // Store event listener reference

/**
 * Initialize workflow scheduler
 * - Loads all workflows from database
 * - Schedules time-based triggers
 * - Sets up event listener for canvas events
 */
export const initializeWorkflowScheduler = async (actionServices, eventBus) => {
  console.log('🎯 Initializing Workflow Scheduler...');

  try {
    // For MVP, we'll handle workspace-specific scheduler activation
    // In production, this would be called per workspace or globally
    console.log('✅ Workflow Scheduler initialized (ready to accept workflows)');
    return { status: 'ready' };
  } catch (error) {
    console.error('❌ Error initializing Workflow Scheduler:', error);
    throw error;
  }
};

/**
 * Register a workspace for workflow evaluation
 * Load all workflows for workspace + schedule time-based triggers
 */
export const registerWorkspaceScheduler = async (workspaceId, actionServices, eventBus) => {
  console.log(`📋 Registering scheduler for workspace: ${workspaceId}`);

  try {
    const workflows = await WorkflowModel.getWorkflowsByWorkspaceId(workspaceId);
    console.log(`  Found ${workflows.length} workflows`);

    workflows.forEach((workflow) => {
      if (workflow.isEnabled) {
        scheduleWorkflow(workflow, actionServices, eventBus);
      }
    });

    return { status: 'registered', workflowCount: workflows.length };
  } catch (error) {
    console.error(`❌ Error registering workspace scheduler:`, error);
    throw error;
  }
};

/**
 * Schedule a workflow's time-based triggers
 */
const scheduleWorkflow = (workflow, actionServices, eventBus) => {
  const { workflowId, triggers } = workflow;

  // Find time-based triggers
  const timeBasedTriggers = triggers.filter((t) => t.type === 'time-based');

  timeBasedTriggers.forEach((trigger) => {
    const { rule } = trigger;
    const { frequency, time, cronExpression } = rule;

    let cronExpStr = null;

    // Convert frequency + time to cron expression
    if (frequency && time) {
      const [hour, minute] = time.split(':').map(Number);

      switch (frequency) {
        case 'daily':
          cronExpStr = `${minute} ${hour} * * *`; // Daily at HH:MM
          break;
        case 'weekly':
          // Default to Monday
          const dayOfWeek = rule.dayOfWeek || 1;
          cronExpStr = `${minute} ${hour} * * ${dayOfWeek}`; // Weekly on specific day
          break;
        case 'monthly':
          // Default to 1st of month
          const dayOfMonth = rule.dayOfMonth || 1;
          cronExpStr = `${minute} ${hour} ${dayOfMonth} * *`; // Monthly on specific day
          break;
      }
    } else if (cronExpression) {
      cronExpStr = cronExpression;
    }

    if (!cronExpStr) {
      console.warn(`⚠️ Could not parse cron expression for workflow ${workflowId}`);
      return;
    }

    console.log(`  ⏱️ Scheduling time-based trigger: ${cronExpStr}`);

    // Create and store cron job
    const job = cron.schedule(cronExpStr, async () => {
      console.log(`🔔 Time-based trigger fired for workflow: ${workflowId}`);
      await evaluateAndExecuteWorkflow(workflow, { type: 'time-based-trigger' }, actionServices);
    });

    cronJobs.set(`${workflowId}-time-${Date.now()}`, job);
  });
};

/**
 * Handle canvas event (status change, approval, etc.)
 * Called when node status changes on canvas
 */
export const handleCanvasEvent = async (event, actionServices) => {
  const { workspaceId, nodeId, type, data } = event;

  console.log(`📡 Canvas event received: ${type} for node ${nodeId}`);

  try {
    // Get all workflows for this workspace
    const workflows = await WorkflowModel.getWorkflowsByWorkspaceId(workspaceId);

    // Evaluate each workflow
    for (const workflow of workflows) {
      if (!workflow.isEnabled) continue;

      // Check if any trigger matches this event
      const { triggers, logicOperator } = workflow;
      const eventData = {
        nodeId,
        workspaceId,
        type,
        ...data,
        timestamp: new Date().toISOString()
      };

      const shouldTrigger = RuleMatcher.evaluateAllTriggers(triggers, logicOperator, eventData);

      if (shouldTrigger) {
        console.log(`  ✓ Workflow triggered: ${workflow.name} (${workflow.workflowId})`);
        await evaluateAndExecuteWorkflow(workflow, eventData, actionServices);
      }
    }
  } catch (error) {
    console.error(`❌ Error handling canvas event:`, error);
  }
};

/**
 * Handle webhook trigger
 * External system calls workflow via webhook
 */
export const handleWebhookTrigger = async (workflowId, payloadData, actionServices) => {
  console.log(`🌐 Webhook triggered for workflow: ${workflowId}`);

  try {
    const workflow = await WorkflowModel.getWorkflowById(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (!workflow.isEnabled) {
      throw new Error(`Workflow is disabled: ${workflowId}`);
    }

    const eventData = {
      type: 'webhook-trigger',
      workspaceId: workflow.workspaceId,
      ...payloadData,
      timestamp: new Date().toISOString()
    };

    await evaluateAndExecuteWorkflow(workflow, eventData, actionServices);
  } catch (error) {
    console.error(`❌ Error handling webhook trigger:`, error);
    throw error;
  }
};

/**
 * Evaluate workflow triggers and execute if matched
 */
const evaluateAndExecuteWorkflow = async (workflow, eventData, actionServices) => {
  try {
    // Evaluate all triggers + logic operator
    const { triggers, logicOperator } = workflow;
    const shouldExecute = RuleMatcher.evaluateAllTriggers(triggers, logicOperator, eventData);

    if (!shouldExecute) {
      console.log(`  ✗ Workflow conditions not met: ${workflow.workflowId}`);
      return;
    }

    console.log(`  🚀 Executing workflow actions...`);

    // Execute all actions
    const result = await WorkflowExecutor.executeWorkflow(workflow, eventData, actionServices);

    console.log(`  ✅ Workflow execution completed: ${result.executionId}`);
    return result;
  } catch (error) {
    console.error(`❌ Error evaluating/executing workflow:`, error);
    throw error;
  }
};

/**
 * Unschedule a workflow (remove cron jobs)
 */
export const unscheduleWorkflow = (workflowId) => {
  console.log(`🗑️ Unscheduling workflow: ${workflowId}`);

  // Find and stop all cron jobs for this workflow
  for (const [key, job] of cronJobs.entries()) {
    if (key.startsWith(workflowId)) {
      job.stop();
      cronJobs.delete(key);
      console.log(`  Stopped cron job: ${key}`);
    }
  }
};

/**
 * Reschedule a workflow (update triggers)
 */
export const rescheduleWorkflow = async (workflowId, actionServices, eventBus) => {
  console.log(`🔄 Rescheduling workflow: ${workflowId}`);

  unscheduleWorkflow(workflowId);

  const workflow = await WorkflowModel.getWorkflowById(workflowId);
  if (workflow && workflow.isEnabled) {
    scheduleWorkflow(workflow, actionServices, eventBus);
  }
};

/**
 * Enable workflow (schedule if not scheduled)
 */
export const enableWorkflowSchedule = async (workflowId, actionServices, eventBus) => {
  const workflow = await WorkflowModel.getWorkflowById(workflowId);
  if (workflow) {
    scheduleWorkflow(workflow, actionServices, eventBus);
  }
};

/**
 * Disable workflow (unschedule cron jobs)
 */
export const disableWorkflowSchedule = (workflowId) => {
  unscheduleWorkflow(workflowId);
};

/**
 * Get all active cron jobs
 */
export const getActiveCronJobs = () => {
  return Array.from(cronJobs.keys());
};

/**
 * Stop all schedulers (cleanup on server shutdown)
 */
export const stopAllSchedulers = () => {
  console.log('🛑 Stopping all workflow schedulers...');
  cronJobs.forEach((job) => job.stop());
  cronJobs.clear();
  console.log('✅ All schedulers stopped');
};
