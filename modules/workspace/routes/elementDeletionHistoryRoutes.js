import express from 'express';
import * as elementDeletionHistoryController from '../controllers/elementDeletionHistoryController.js';

const router = express.Router();

/**
 * Record element deletion
 */
router.post('/', elementDeletionHistoryController.recordElementDeletion);

/**
 * Get deletion history for a specific subtask (must come before /:deletionId)
 */
router.get('/subtask/:subtaskId', elementDeletionHistoryController.getSubtaskDeletionHistory);

/**
 * Get deletion history for a specific element (must come before /:deletionId)
 */
router.get('/element/:elementId', elementDeletionHistoryController.getElementDeletionHistory);

/**
 * Get deletion history for a workspace
 */
router.get('/workspace/:workspaceId', elementDeletionHistoryController.getWorkspaceDeletionHistory);

/**
 * Get deletion history by time range
 */
router.get('/workspace/:workspaceId/range', elementDeletionHistoryController.getDeletionsByTimeRange);

/**
 * Get deletion history for a specific user
 */
router.get('/workspace/:workspaceId/user/:userEmail', elementDeletionHistoryController.getDeletionsByUser);

/**
 * Get deletion statistics for a workspace
 */
router.get('/workspace/:workspaceId/statistics', elementDeletionHistoryController.getDeletionStatistics);

/**
 * Get a specific deletion record (must come last)
 */
router.get('/:deletionId', elementDeletionHistoryController.getDeletionById);

/**
 * Mark deletion as recovered
 */
router.put('/:deletionId/recover', elementDeletionHistoryController.markAsRecovered);

/**
 * Delete a deletion record (permanent cleanup)
 */
router.delete('/:deletionId', elementDeletionHistoryController.deleteDeletionRecord);

export default router;
