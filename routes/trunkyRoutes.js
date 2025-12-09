import express from 'express';
import { 
  getTrunkyTasks, 
  getTrunkyTaskById, 
  getTrunkyDataForWorkspace 
} from '../controllers/trunkyController.js';

const router = express.Router();

// Get all Trunky tasks
router.get('/tasks', getTrunkyTasks);

// Get specific Trunky task by ID
router.get('/tasks/:taskId', getTrunkyTaskById);

// Get Trunky data for workspace element
router.get('/workspace/:workspaceId/element/:elementId', getTrunkyDataForWorkspace);

export default router;
