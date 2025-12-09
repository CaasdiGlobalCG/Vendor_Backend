import express from 'express';
import {
  saveTurnkeyWorkflow,
  getTurnkeyWorkflow,
  updateTestCase,
  addTestCaseEvidence,
  removeTestCaseEvidence,
  getAllTurnkeyWorkflows
} from '../controllers/turnkeyWorkflowController.js';

const router = express.Router();

/**
 * Turnkey Workflow API Routes
 * 
 * Base path: /api/turnkey-workflows
 */

// Get all turnkey workflows in a workspace
router.get('/workspace/:workspaceId', getAllTurnkeyWorkflows);

// Get specific turnkey workflow
router.get('/workspace/:workspaceId/node/:nodeId', getTurnkeyWorkflow);

// Create or update turnkey workflow
router.put('/workspace/:workspaceId/node/:nodeId', saveTurnkeyWorkflow);
router.post('/workspace/:workspaceId/node/:nodeId', saveTurnkeyWorkflow);

// Test case operations
router.put('/workspace/:workspaceId/node/:nodeId/testcase/:testCaseId', updateTestCase);

// Evidence file operations
router.post('/workspace/:workspaceId/node/:nodeId/testcase/:testCaseId/evidence', addTestCaseEvidence);
router.delete('/workspace/:workspaceId/node/:nodeId/testcase/:testCaseId/evidence/:fileId', removeTestCaseEvidence);

export default router;

