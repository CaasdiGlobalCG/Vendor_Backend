/**
 * Workflow Controller: API handlers for workflow endpoints
 */

import * as WorkflowService from '../services/workflowService.js';

/**
 * POST /api/workflows
 * Create a new workflow
 */
export const createWorkflow = async (req, res) => {
  try {
    const { workspaceId, name, description, triggers, actions, logicOperator = 'AND', createdBy } = req.body;

    // Validate required fields
    if (!workspaceId || !name) {
      return res.status(400).json({
        message: 'workspaceId and name are required'
      });
    }

    if (!triggers || triggers.length === 0) {
      return res.status(400).json({
        message: 'At least one trigger is required'
      });
    }

    if (!actions || actions.length === 0) {
      return res.status(400).json({
        message: 'At least one action is required'
      });
    }

    // Validate workflow structure
    const validation = WorkflowService.validateWorkflow({
      workspaceId,
      name,
      triggers,
      actions,
      logicOperator
    });

    if (!validation.isValid) {
      return res.status(400).json({
        message: 'Workflow validation failed',
        errors: validation.errors
      });
    }

    const workflow = await WorkflowService.createWorkflow({
      workspaceId,
      name,
      description,
      triggers,
      actions,
      logicOperator,
      createdBy: createdBy || req.user?.email || 'anonymous',
      isEnabled: req.body.isEnabled !== false
    });

    res.status(201).json({
      message: 'Workflow created successfully',
      workflow
    });
  } catch (error) {
    console.error('❌ Error creating workflow:', error);
    res.status(500).json({
      message: 'Failed to create workflow',
      error: error.message
    });
  }
};

/**
 * GET /api/workflows/:workflowId
 * Get a specific workflow
 */
export const getWorkflow = async (req, res) => {
  try {
    const { workflowId } = req.params;

    const workflow = await WorkflowService.getWorkflow(workflowId);

    res.status(200).json({
      message: 'Workflow retrieved successfully',
      workflow
    });
  } catch (error) {
    console.error('❌ Error getting workflow:', error);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      message: 'Failed to get workflow',
      error: error.message
    });
  }
};

/**
 * GET /api/workflows?workspaceId=:workspaceId
 * Get all workflows for a workspace
 */
export const getWorkflowsByWorkspace = async (req, res) => {
  try {
    const { workspaceId } = req.query;

    if (!workspaceId) {
      return res.status(400).json({
        message: 'workspaceId query parameter is required'
      });
    }

    const workflows = await WorkflowService.getWorkflowsByWorkspace(workspaceId);

    res.status(200).json({
      message: 'Workflows retrieved successfully',
      workspaceId,
      count: workflows.length,
      workflows
    });
  } catch (error) {
    console.error('❌ Error getting workflows:', error);
    res.status(500).json({
      message: 'Failed to get workflows',
      error: error.message
    });
  }
};

/**
 * PUT /api/workflows/:workflowId
 * Update a workflow
 */
export const updateWorkflow = async (req, res) => {
  try {
    const { workflowId } = req.params;
    const { name, description, triggers, actions, logicOperator, isEnabled } = req.body;

    // Validate updates if triggers/actions changed
    if (triggers !== undefined || actions !== undefined) {
      const workflow = await WorkflowService.getWorkflow(workflowId);
      const validation = WorkflowService.validateWorkflow({
        workspaceId: workflow.workspaceId,
        name: name || workflow.name,
        triggers: triggers || workflow.triggers,
        actions: actions || workflow.actions,
        logicOperator: logicOperator || workflow.logicOperator
      });

      if (!validation.isValid) {
        return res.status(400).json({
          message: 'Workflow validation failed',
          errors: validation.errors
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (triggers !== undefined) updateData.triggers = triggers;
    if (actions !== undefined) updateData.actions = actions;
    if (logicOperator !== undefined) updateData.logicOperator = logicOperator;
    if (isEnabled !== undefined) updateData.isEnabled = isEnabled;

    const workflow = await WorkflowService.updateWorkflow(workflowId, updateData, req.app.locals.actionServices);

    res.status(200).json({
      message: 'Workflow updated successfully',
      workflow
    });
  } catch (error) {
    console.error('❌ Error updating workflow:', error);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      message: 'Failed to update workflow',
      error: error.message
    });
  }
};

/**
 * DELETE /api/workflows/:workflowId
 * Delete a workflow
 */
export const deleteWorkflow = async (req, res) => {
  try {
    const { workflowId } = req.params;

    await WorkflowService.deleteWorkflow(workflowId);

    res.status(200).json({
      message: 'Workflow deleted successfully',
      workflowId
    });
  } catch (error) {
    console.error('❌ Error deleting workflow:', error);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      message: 'Failed to delete workflow',
      error: error.message
    });
  }
};

/**
 * POST /api/workflows/:workflowId/enable
 * Enable a workflow
 */
export const enableWorkflow = async (req, res) => {
  try {
    const { workflowId } = req.params;

    await WorkflowService.enableWorkflow(workflowId, req.app.locals.actionServices);

    res.status(200).json({
      message: 'Workflow enabled successfully',
      workflowId,
      status: 'enabled'
    });
  } catch (error) {
    console.error('❌ Error enabling workflow:', error);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      message: 'Failed to enable workflow',
      error: error.message
    });
  }
};

/**
 * POST /api/workflows/:workflowId/disable
 * Disable a workflow
 */
export const disableWorkflow = async (req, res) => {
  try {
    const { workflowId } = req.params;

    await WorkflowService.disableWorkflow(workflowId);

    res.status(200).json({
      message: 'Workflow disabled successfully',
      workflowId,
      status: 'disabled'
    });
  } catch (error) {
    console.error('❌ Error disabling workflow:', error);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      message: 'Failed to disable workflow',
      error: error.message
    });
  }
};

/**
 * GET /api/workflows/:workflowId/execution-log
 * Get execution history for a workflow
 */
export const getExecutionLog = async (req, res) => {
  try {
    const { workflowId } = req.params;
    const { limit = 100 } = req.query;

    const history = await WorkflowService.getExecutionHistory(workflowId, parseInt(limit));

    res.status(200).json({
      message: 'Execution history retrieved successfully',
      ...history
    });
  } catch (error) {
    console.error('❌ Error getting execution log:', error);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      message: 'Failed to get execution log',
      error: error.message
    });
  }
};

/**
 * GET /api/workflows/:workflowId/stats
 * Get execution statistics for a workflow
 */
export const getExecutionStats = async (req, res) => {
  try {
    const { workflowId } = req.params;

    const stats = await WorkflowService.getExecutionStats(workflowId);

    res.status(200).json({
      message: 'Execution statistics retrieved successfully',
      stats
    });
  } catch (error) {
    console.error('❌ Error getting execution stats:', error);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      message: 'Failed to get execution statistics',
      error: error.message
    });
  }
};

/**
 * POST /api/workflows/:workflowId/test
 * Test trigger evaluation against sample data
 */
export const testWorkflow = async (req, res) => {
  try {
    const { workflowId } = req.params;
    const { eventData } = req.body;

    if (!eventData) {
      return res.status(400).json({
        message: 'eventData is required for testing'
      });
    }

    const workflow = await WorkflowService.getWorkflow(workflowId);

    // Import RuleMatcher for testing
    const RuleMatcher = await import('../services/ruleMatcher.js');
    const shouldTrigger = RuleMatcher.evaluateAllTriggers(
      workflow.triggers,
      workflow.logicOperator,
      eventData
    );

    res.status(200).json({
      message: 'Workflow test completed',
      workflowId,
      shouldTrigger,
      eventData,
      triggerCount: workflow.triggers.length,
      actionCount: workflow.actions.length
    });
  } catch (error) {
    console.error('❌ Error testing workflow:', error);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      message: 'Failed to test workflow',
      error: error.message
    });
  }
};
