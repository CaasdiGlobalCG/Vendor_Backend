import express from 'express';
import * as dynamoActivityController from '../controllers/dynamoActivityController.js';

const router = express.Router();

// Create a new activity
router.post('/activities', dynamoActivityController.createActivity);

// Create multiple activities in bulk
router.post('/activities/bulk', dynamoActivityController.createBulkActivities);

// Get activities for a workspace
router.get('/workspaces/:workspaceId/activities', dynamoActivityController.getWorkspaceActivities);

// Get activities grouped by date
router.get('/workspaces/:workspaceId/activities/grouped', dynamoActivityController.getActivitiesGroupedByDate);

// Get recent activities for a workspace
router.get('/workspaces/:workspaceId/activities/recent', dynamoActivityController.getRecentActivities);

// Get activity statistics for a workspace
router.get('/workspaces/:workspaceId/activities/stats', dynamoActivityController.getActivityStats);

export default router;
