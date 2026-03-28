import express from 'express';
import * as dynamoProjectController from '../controllers/dynamoProjectController.js';
import { getProjectMemberAccess, updateProjectMemberAccess } from '../../rbac/controllers/resourceAssignmentController.js';
import { authenticateCognitoJwt } from '../../../middleware/cognitoJwtMiddleware.js';
import { attachVendorId } from '../../../middleware/attachVendorId.js';
import { attachRBAC } from '../../rbac/middleware/attachRBAC.js';
import { requirePermission } from '../../rbac/middleware/requirePermission.js';

const router = express.Router();

router.use(authenticateCognitoJwt);
router.use(attachVendorId);
router.use(attachRBAC);

// Create a new project
router.post('/projects', requirePermission('projects', 'create'), dynamoProjectController.createProject);

// Get all projects
router.get('/projects', requirePermission('projects', 'view'), dynamoProjectController.getAllProjects);

// Get project by ID
router.get('/projects/:id', requirePermission('projects', 'view'), dynamoProjectController.getProjectById);

// Get direct member assignment state for a project
router.get('/projects/:id/member-access', requirePermission('projects', 'view'), getProjectMemberAccess);

// Add/remove direct member access for a project
router.patch('/projects/:id/member-access', requirePermission('projects', 'edit'), updateProjectMemberAccess);

// Get projects by vendor ID
router.get('/projects/vendor/:vendorId', requirePermission('projects', 'view'), dynamoProjectController.getProjectsByVendorId);

// Get projects by client ID
router.get('/projects/client/:clientId', requirePermission('projects', 'view'), dynamoProjectController.getProjectsByClientId);

// Update a project
router.put('/projects/:id', requirePermission('projects', 'edit'), dynamoProjectController.updateProject);

// Delete a project
router.delete('/projects/:id', requirePermission('projects', 'delete'), dynamoProjectController.deleteProject);

export default router;