import express from 'express';
import { getWorkspaceByProjectId } from '../models/DynamoWorkspace.js';

const router = express.Router();

// GET /api/workspaces/project/:projectId - get workspace status by projectId
router.get('/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const workspace = await getWorkspaceByProjectId(projectId);
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    // Normalize status for UI, check both status and project_status fields
    let status = (workspace.status || '').toLowerCase();
    let projectStatus = (workspace.project_status || '').toLowerCase();
    let normalizedStatus = 'Pending';
    if (status === 'project completed' || status === 'completed' || projectStatus === 'project completed' || projectStatus === 'completed') {
      normalizedStatus = 'Completed';
    } else if (status === 'in progress' || status === 'active' || status === 'inprogress' || projectStatus === 'in progress' || projectStatus === 'active' || projectStatus === 'inprogress') {
      normalizedStatus = 'InProgress';
    }
    return res.json({ status: normalizedStatus });
  } catch (err) {
    console.error('Error fetching workspace by projectId:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;