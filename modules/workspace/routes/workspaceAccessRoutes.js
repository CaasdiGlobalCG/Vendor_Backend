import express from 'express';
import * as workspaceAccessController from '../controllers/workspaceAccessController.js';
import { authenticateCognitoJwt } from '../../../middleware/cognitoJwtMiddleware.js';
import { attachVendorId } from '../../../middleware/attachVendorId.js';
import { attachRBAC } from '../../rbac/middleware/attachRBAC.js';
import { requirePermission } from '../../rbac/middleware/requirePermission.js';

const router = express.Router();

// For userType=client the workspace's own accessControl/sharedWith lists are the
// gate — vendor-org RBAC scope doesn't apply to client users.
const requireWorkspaceViewUnlessClient = (req, res, next) => {
  if (req.query.userType === 'client') return next();
  return requirePermission('workspace', 'view')(req, res, next);
};

router.use(authenticateCognitoJwt);
router.use(attachVendorId);
router.use(attachRBAC);

// Workspace Access Control Routes

// Create or get collaborative workspace for approved PM-Vendor pairs
router.post('/collaborative', requirePermission('workspace', 'view'), workspaceAccessController.createOrGetCollaborativeWorkspace);

// Get workspace access status for user
router.get('/:workspaceId/access-status', requirePermission('workspace', 'view'), workspaceAccessController.getWorkspaceAccessStatus);

// Verify workspace access (middleware route - used by other workspace routes)
router.use('/:workspaceId/verify', requireWorkspaceViewUnlessClient, workspaceAccessController.verifyWorkspaceAccess);

export default router;
