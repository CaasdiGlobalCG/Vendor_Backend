import express from 'express';
import * as WorkflowController from '../controllers/workflowController.js';

const router = express.Router();

/**
 * Workflow CRUD Routes
 */

/**
 * POST /api/workflows
 * Create a new workflow
 */
router.post('/', WorkflowController.createWorkflow);

/**
 * GET /api/workflows?workspaceId=:workspaceId
 * Get all workflows for a workspace
 */
router.get('/', WorkflowController.getWorkflowsByWorkspace);

/**
 * GET /api/workflows/:workflowId
 * Get a specific workflow
 */
router.get('/:workflowId', WorkflowController.getWorkflow);

/**
 * PUT /api/workflows/:workflowId
 * Update a workflow
 */
router.put('/:workflowId', WorkflowController.updateWorkflow);

/**
 * DELETE /api/workflows/:workflowId
 * Delete a workflow
 */
router.delete('/:workflowId', WorkflowController.deleteWorkflow);

/**
 * Workflow Control Routes
 */

/**
 * POST /api/workflows/:workflowId/enable
 * Enable a workflow
 */
router.post('/:workflowId/enable', WorkflowController.enableWorkflow);

/**
 * POST /api/workflows/:workflowId/disable
 * Disable a workflow
 */
router.post('/:workflowId/disable', WorkflowController.disableWorkflow);

/**
 * Execution History Routes
 */

/**
 * GET /api/workflows/:workflowId/execution-log
 * Get execution history
 */
router.get('/:workflowId/execution-log', WorkflowController.getExecutionLog);

/**
 * GET /api/workflows/:workflowId/stats
 * Get execution statistics
 */
router.get('/:workflowId/stats', WorkflowController.getExecutionStats);

/**
 * Testing & Debugging Routes
 */

/**
 * POST /api/workflows/:workflowId/test
 * Test trigger evaluation
 */
router.post('/:workflowId/test', WorkflowController.testWorkflow);

export default router;
