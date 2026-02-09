import * as DeletionHistory from '../models/DynamoElementDeletionHistory.js';

/**
 * Record element deletion
 * POST /api/element-deletion-history
 */
export const recordElementDeletion = async (req, res) => {
  try {
    const {
      workspaceId,
      taskId,
      subtaskId,
      elementId,
      elementType,
      elementName,
      elementData,
      deletedBy,
      deletedByEmail,
      deletedByRole,
      position,
      details
    } = req.body;

    // Validate required fields
    if (!workspaceId || !elementId) {
      return res.status(400).json({
        message: 'workspaceId and elementId are required'
      });
    }

    const deletionRecord = await DeletionHistory.recordElementDeletion({
      workspaceId,
      taskId,
      subtaskId,
      elementId,
      elementType,
      elementName,
      elementData,
      deletedBy,
      deletedByEmail,
      deletedByRole,
      position,
      details
    });

    res.status(201).json({
      message: 'Element deletion recorded successfully',
      deletion: deletionRecord
    });
  } catch (error) {
    console.error('❌ Error recording element deletion:', error);
    res.status(500).json({
      message: 'Failed to record element deletion',
      error: error.message
    });
  }
};

/**
 * Get deletion history for a workspace
 * GET /api/element-deletion-history/workspace/:workspaceId
 */
export const getWorkspaceDeletionHistory = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { limit = 100 } = req.query;

    if (!workspaceId) {
      return res.status(400).json({
        message: 'workspaceId is required'
      });
    }

    const history = await DeletionHistory.getWorkspaceDeletionHistory(workspaceId, parseInt(limit));

    res.status(200).json({
      message: 'Deletion history retrieved successfully',
      workspaceId,
      count: history.length,
      deletions: history
    });
  } catch (error) {
    console.error('❌ Error retrieving deletion history:', error);
    res.status(500).json({
      message: 'Failed to retrieve deletion history',
      error: error.message
    });
  }
};

/**
 * Get deletion history for a specific element
 * GET /api/element-deletion-history/element/:elementId
 */
export const getElementDeletionHistory = async (req, res) => {
  try {
    const { elementId } = req.params;

    if (!elementId) {
      return res.status(400).json({
        message: 'elementId is required'
      });
    }

    const history = await DeletionHistory.getElementDeletionHistory(elementId);

    res.status(200).json({
      message: 'Element deletion history retrieved successfully',
      elementId,
      count: history.length,
      deletions: history
    });
  } catch (error) {
    console.error('❌ Error retrieving element deletion history:', error);
    res.status(500).json({
      message: 'Failed to retrieve element deletion history',
      error: error.message
    });
  }
};

/**
 * Get deletion history for a specific subtask
 * GET /api/element-deletion-history/subtask/:subtaskId
 */
export const getSubtaskDeletionHistory = async (req, res) => {
  try {
    const { subtaskId } = req.params;
    const { limit = 100 } = req.query;

    console.log('📋 getSubtaskDeletionHistory called with subtaskId:', subtaskId, 'limit:', limit);

    if (!subtaskId) {
      return res.status(400).json({
        message: 'subtaskId is required'
      });
    }

    const history = await DeletionHistory.getSubtaskDeletionHistory(subtaskId, parseInt(limit));
    
    console.log('✅ Retrieved history records:', history.length, 'subtaskId:', subtaskId);

    res.status(200).json({
      message: 'Subtask deletion history retrieved successfully',
      subtaskId,
      count: history.length,
      deletions: history
    });
  } catch (error) {
    console.error('❌ Error retrieving subtask deletion history:', error);
    res.status(500).json({
      message: 'Failed to retrieve subtask deletion history',
      error: error.message
    });
  }
};

/**
 * Get deletion history by time range
 * GET /api/element-deletion-history/workspace/:workspaceId/range
 */
export const getDeletionsByTimeRange = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { startTime, endTime } = req.query;

    if (!workspaceId || !startTime || !endTime) {
      return res.status(400).json({
        message: 'workspaceId, startTime, and endTime are required'
      });
    }

    const history = await DeletionHistory.getDeletionHistoryByTimeRange(
      workspaceId,
      startTime,
      endTime
    );

    res.status(200).json({
      message: 'Deletion history retrieved successfully',
      workspaceId,
      timeRange: { startTime, endTime },
      count: history.length,
      deletions: history
    });
  } catch (error) {
    console.error('❌ Error retrieving deletion history by time range:', error);
    res.status(500).json({
      message: 'Failed to retrieve deletion history',
      error: error.message
    });
  }
};

/**
 * Get deletion history for a specific user
 * GET /api/element-deletion-history/workspace/:workspaceId/user/:userEmail
 */
export const getDeletionsByUser = async (req, res) => {
  try {
    const { workspaceId, userEmail } = req.params;
    const { limit = 100 } = req.query;

    if (!workspaceId || !userEmail) {
      return res.status(400).json({
        message: 'workspaceId and userEmail are required'
      });
    }

    const history = await DeletionHistory.getDeletionHistoryByUser(
      workspaceId,
      userEmail,
      parseInt(limit)
    );

    res.status(200).json({
      message: 'User deletion history retrieved successfully',
      workspaceId,
      userEmail,
      count: history.length,
      deletions: history
    });
  } catch (error) {
    console.error('❌ Error retrieving user deletion history:', error);
    res.status(500).json({
      message: 'Failed to retrieve user deletion history',
      error: error.message
    });
  }
};

/**
 * Get a specific deletion record
 * GET /api/element-deletion-history/:deletionId
 */
export const getDeletionById = async (req, res) => {
  try {
    const { deletionId } = req.params;

    if (!deletionId) {
      return res.status(400).json({
        message: 'deletionId is required'
      });
    }

    const deletion = await DeletionHistory.getDeletionById(deletionId);

    if (!deletion) {
      return res.status(404).json({
        message: 'Deletion record not found'
      });
    }

    res.status(200).json({
      message: 'Deletion record retrieved successfully',
      deletion
    });
  } catch (error) {
    console.error('❌ Error retrieving deletion record:', error);
    res.status(500).json({
      message: 'Failed to retrieve deletion record',
      error: error.message
    });
  }
};

/**
 * Mark deletion as recovered (delete from history)
 * PUT /api/element-deletion-history/:deletionId/recover
 */
export const markAsRecovered = async (req, res) => {
  try {
    const { deletionId } = req.params;
    const { recoveredBy, recoveredByEmail } = req.body;

    console.log('🔄 Recovering deletion:', { deletionId, recoveredBy });

    if (!deletionId) {
      return res.status(400).json({
        message: 'deletionId is required'
      });
    }

    // Delete the deletion record from the table
    const result = await DeletionHistory.deleteDeletionRecord(deletionId);

    console.log('✅ Deletion record deleted (element restored):', deletionId);

    res.status(200).json({
      message: 'Element restored - deletion record removed from history',
      result
    });
  } catch (error) {
    console.error('❌ Error recovering deletion:', error);
    res.status(500).json({
      message: 'Failed to recover deletion',
      error: error.message
    });
  }
};

/**
 * Get deletion statistics for a workspace
 * GET /api/element-deletion-history/workspace/:workspaceId/statistics
 */
export const getDeletionStatistics = async (req, res) => {
  try {
    const { workspaceId } = req.params;

    if (!workspaceId) {
      return res.status(400).json({
        message: 'workspaceId is required'
      });
    }

    const stats = await DeletionHistory.getDeletionStatistics(workspaceId);

    res.status(200).json({
      message: 'Deletion statistics retrieved successfully',
      workspaceId,
      statistics: stats
    });
  } catch (error) {
    console.error('❌ Error retrieving deletion statistics:', error);
    res.status(500).json({
      message: 'Failed to retrieve deletion statistics',
      error: error.message
    });
  }
};

/**
 * Delete a deletion record (permanent cleanup)
 * DELETE /api/element-deletion-history/:deletionId
 */
export const deleteDeletionRecord = async (req, res) => {
  try {
    const { deletionId } = req.params;

    if (!deletionId) {
      return res.status(400).json({
        message: 'deletionId is required'
      });
    }

    const result = await DeletionHistory.deleteDeletionRecord(deletionId);

    res.status(200).json({
      message: 'Deletion record deleted successfully',
      result
    });
  } catch (error) {
    console.error('❌ Error deleting deletion record:', error);
    res.status(500).json({
      message: 'Failed to delete deletion record',
      error: error.message
    });
  }
};
