import express from 'express';
import * as dynamoProjectController from '../controllers/dynamoProjectController.js';

const router = express.Router();

// Create a new project
router.post('/projects', dynamoProjectController.createProject);

// Get all projects
router.get('/projects', dynamoProjectController.getAllProjects);

// Get project by ID
router.get('/projects/:id', dynamoProjectController.getProjectById);

// Get projects by vendor ID
router.get('/projects/vendor/:vendorId', dynamoProjectController.getProjectsByVendorId);

// Get projects by client ID
router.get('/projects/client/:clientId', dynamoProjectController.getProjectsByClientId);

// Update a project
router.put('/projects/:id', dynamoProjectController.updateProject);

// Delete a project
router.delete('/projects/:id', dynamoProjectController.deleteProject);

export default router;