import express from 'express';
import * as pmIntegrationController from '../controllers/pmIntegrationController.js';

const router = express.Router();

// PM Workspace Management
router.post('/create-workspace', pmIntegrationController.createWorkspaceForPM);
router.get('/workspace/:workspaceId', pmIntegrationController.getWorkspaceForPM);
router.put('/workspace/:workspaceId/permissions', pmIntegrationController.updateWorkspacePermissions);

// Vendor Directory for PM
router.get('/vendor-directory', pmIntegrationController.getVendorDirectory);

export default router;
