import express from 'express';
import * as pmProjectController from '../controllers/pmProjectController.js';
import { verifyPMToken } from '../controllers/pmAuthController.js';

const router = express.Router();

// All routes require PM authentication
router.use(verifyPMToken);

// Project CRUD Routes
router.get('/', pmProjectController.getPMProjects);                    // GET /api/pm-projects
router.get('/stats', pmProjectController.getPMProjectStats);          // GET /api/pm-projects/stats
router.get('/:projectId', pmProjectController.getPMProject);          // GET /api/pm-projects/:projectId
router.post('/', pmProjectController.createPMProject);               // POST /api/pm-projects
router.put('/:projectId', pmProjectController.updatePMProject);      // PUT /api/pm-projects/:projectId
router.delete('/:projectId', pmProjectController.deletePMProject);   // DELETE /api/pm-projects/:projectId

export default router;
