import express from 'express';
import * as dynamoPMProjectController from '../controllers/dynamoPMProjectController.js';

const router = express.Router();

// Create a new PM project
router.post('/pm-projects', dynamoPMProjectController.createPMProject);

// Get all PM projects
router.get('/pm-projects', dynamoPMProjectController.getAllPMProjects);

// Get PM project by ID
router.get('/pm-projects/:id', dynamoPMProjectController.getPMProjectById);

// Get PM projects by vendor ID
router.get('/pm-projects/vendor/:vendorId', dynamoPMProjectController.getPMProjectsByVendorId);

// Get PM projects by client ID
router.get('/pm-projects/client/:clientId', dynamoPMProjectController.getPMProjectsByClientId);

// Get PM project by lead ID
router.get('/pm-projects/lead/:leadId', dynamoPMProjectController.getPMProjectByLeadId);

// Update a PM project
router.put('/pm-projects/:id', dynamoPMProjectController.updatePMProject);

// Delete a PM project
router.delete('/pm-projects/:id', dynamoPMProjectController.deletePMProject);

export default router;
