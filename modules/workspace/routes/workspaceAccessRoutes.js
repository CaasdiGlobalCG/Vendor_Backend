import express from 'express';
import * as workspaceAccessController from '../controllers/workspaceAccessController.js';

const router = express.Router();

// Workspace Access Control Routes

// Create or get collaborative workspace for approved PM-Vendor pairs
router.post('/collaborative', workspaceAccessController.createOrGetCollaborativeWorkspace);

// Get workspace access status for user
router.get('/:workspaceId/access-status', workspaceAccessController.getWorkspaceAccessStatus);

// Verify workspace access (middleware route - used by other workspace routes)
router.use('/:workspaceId/verify', workspaceAccessController.verifyWorkspaceAccess);

export default router;
