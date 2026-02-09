import { dynamoDB } from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

const DELETION_HISTORY_TABLE = 'element_deletion_history';

/**
 * Create a deletion history record when an element is deleted
 */
export const recordElementDeletion = async (deletionData) => {
  const {
    workspaceId,
    taskId,
    subtaskId,
    elementId,
    elementType,
    elementName,
    elementData = {},
    deletedBy,
    deletedByEmail,
    deletedByRole,
    position,
    details = {}
  } = deletionData;

  if (!workspaceId || !elementId) {
    throw new Error('workspaceId and elementId are required for deletion history');
  }

  const deletionId = uuidv4();
  const timestamp = new Date().toISOString();

  const params = {
    TableName: DELETION_HISTORY_TABLE,
    Item: {
      // Primary key - unique deletion record ID
      deletionId: deletionId,
      
      // Sort key - workspace ID with timestamp for querying deletions in a workspace
      workspaceId_timestamp: `${workspaceId}#${timestamp}`,
      
      // Core deletion information
      workspaceId: workspaceId,
      taskId: taskId || null,
      subtaskId: subtaskId || null,
      elementId: elementId,
      elementType: elementType || 'unknown',
      elementName: elementName || 'Unnamed Element',
      
      // Who deleted it
      deletedBy: deletedBy || 'system',
      deletedByEmail: deletedByEmail || null,
      deletedByRole: deletedByRole || null,
      
      // When it was deleted
      deletedAt: timestamp,
      
      // Element metadata before deletion - store full element data for recovery
      elementDataSnapshot: {
        ...elementData,
        position: position,
        lastUpdatedAt: elementData.lastUpdatedAt || null,
        lastUpdatedBy: elementData.lastUpdatedBy || null,
        addedAt: elementData.addedAt || null,
        addedBy: elementData.addedBy || null,
        approvalStatus: elementData.approvalStatus || null
      },
      
      // Additional context
      details: {
        ...details,
        deletedVia: details.deletedVia || 'canvas', // canvas, elements-overview, context-menu, etc.
        canvasAction: details.canvasAction || true,
        relatedEdges: details.relatedEdges || [], // IDs of edges that were also deleted with this node
      },
      
      // Status for potential recovery
      status: 'deleted', // deleted, recovered, archived
      recoveredAt: null,
      recoveredBy: null,
      
      // TTL for automatic cleanup (optional - 90 days)
      TTL: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60)
    }
  };

  try {
    await dynamoDB.put(params).promise();
    console.log('✅ Deletion history recorded:', {
      deletionId,
      elementId,
      workspaceId,
      taskId: taskId || 'N/A',
      subtaskId: subtaskId || 'N/A',
      elementType,
      deletedAt: timestamp
    });
    return {
      deletionId,
      ...params.Item
    };
  } catch (error) {
    console.error('❌ Error recording deletion history:', error);
    throw error;
  }
};

/**
 * Get deletion history for a specific workspace
 */
export const getWorkspaceDeletionHistory = async (workspaceId, limit = 100) => {
  if (!workspaceId) {
    throw new Error('workspaceId is required');
  }

  const params = {
    TableName: DELETION_HISTORY_TABLE,
    FilterExpression: 'workspaceId = :workspaceId',
    ExpressionAttributeValues: {
      ':workspaceId': workspaceId
    },
    Limit: limit,
    ScanIndexForward: false // Most recent first
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    console.log(`✅ Retrieved ${result.Items?.length || 0} deletion records for workspace: ${workspaceId}`);
    return result.Items || [];
  } catch (error) {
    console.error('❌ Error retrieving deletion history:', error);
    throw error;
  }
};

/**
 * Get deletion history for a specific element
 */
export const getElementDeletionHistory = async (elementId) => {
  if (!elementId) {
    throw new Error('elementId is required');
  }

  const params = {
    TableName: DELETION_HISTORY_TABLE,
    FilterExpression: 'elementId = :elementId',
    ExpressionAttributeValues: {
      ':elementId': elementId
    }
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    console.log(`✅ Retrieved deletion history for element: ${elementId}`);
    return result.Items || [];
  } catch (error) {
    console.error('❌ Error retrieving element deletion history:', error);
    throw error;
  }
};

/**
 * Get deletion history for a specific subtask
 */
export const getSubtaskDeletionHistory = async (subtaskId, limit = 100) => {
  if (!subtaskId) {
    throw new Error('subtaskId is required');
  }

  console.log('🔍 Scanning for subtask deletions:', subtaskId, 'Limit:', limit);

  const params = {
    TableName: DELETION_HISTORY_TABLE,
    FilterExpression: 'subtaskId = :subtaskId',
    ExpressionAttributeValues: {
      ':subtaskId': subtaskId
    },
    Limit: limit,
    ScanIndexForward: false // Most recent first
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    console.log(`✅ Retrieved ${result.Items?.length || 0} deletion records for subtask: ${subtaskId}`);
    console.log('📊 Items returned:', result.Items?.length);
    return result.Items || [];
  } catch (error) {
    console.error('❌ Error retrieving subtask deletion history:', error);
    throw error;
  }
};

/**
 * Get deletion history within a time range
 */
export const getDeletionHistoryByTimeRange = async (workspaceId, startTime, endTime) => {
  if (!workspaceId || !startTime || !endTime) {
    throw new Error('workspaceId, startTime, and endTime are required');
  }

  const params = {
    TableName: DELETION_HISTORY_TABLE,
    FilterExpression: 'workspaceId = :workspaceId AND deletedAt BETWEEN :startTime AND :endTime',
    ExpressionAttributeValues: {
      ':workspaceId': workspaceId,
      ':startTime': startTime,
      ':endTime': endTime
    }
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    console.log(`✅ Retrieved ${result.Items?.length || 0} deletions in time range for workspace: ${workspaceId}`);
    return result.Items || [];
  } catch (error) {
    console.error('❌ Error retrieving deletion history by time range:', error);
    throw error;
  }
};

/**
 * Get deletion history for a specific user
 */
export const getDeletionHistoryByUser = async (workspaceId, userEmail, limit = 100) => {
  if (!workspaceId || !userEmail) {
    throw new Error('workspaceId and userEmail are required');
  }

  const params = {
    TableName: DELETION_HISTORY_TABLE,
    FilterExpression: 'workspaceId = :workspaceId AND deletedByEmail = :userEmail',
    ExpressionAttributeValues: {
      ':workspaceId': workspaceId,
      ':userEmail': userEmail
    },
    Limit: limit,
    ScanIndexForward: false
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    console.log(`✅ Retrieved ${result.Items?.length || 0} deletions by user: ${userEmail}`);
    return result.Items || [];
  } catch (error) {
    console.error('❌ Error retrieving deletion history by user:', error);
    throw error;
  }
};

/**
 * Mark a deletion as recovered (if elements are restored from history)
 */
export const markDeletionAsRecovered = async (deletionId, recoveredBy, recoveredByEmail) => {
  if (!deletionId) {
    throw new Error('deletionId is required');
  }

  const recoveredAt = new Date().toISOString();

  const params = {
    TableName: DELETION_HISTORY_TABLE,
    Key: { deletionId: deletionId },
    UpdateExpression: 'SET #status = :status, recoveredAt = :recoveredAt, recoveredBy = :recoveredBy, recoveredByEmail = :recoveredByEmail',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': 'recovered',
      ':recoveredAt': recoveredAt,
      ':recoveredBy': recoveredBy || 'system',
      ':recoveredByEmail': recoveredByEmail || null
    }
  };

  try {
    await dynamoDB.update(params).promise();
    console.log('✅ Deletion marked as recovered:', { deletionId, recoveredAt });
    return { deletionId, status: 'recovered', recoveredAt };
  } catch (error) {
    console.error('❌ Error marking deletion as recovered:', error);
    throw error;
  }
};

/**
 * Delete a deletion history record entirely (when element is restored)
 */
export const deleteDeletionRecord = async (deletionId) => {
  if (!deletionId) {
    throw new Error('deletionId is required');
  }

  const params = {
    TableName: DELETION_HISTORY_TABLE,
    Key: { deletionId: deletionId }
  };

  try {
    await dynamoDB.delete(params).promise();
    console.log('✅ Deletion record deleted:', deletionId);
    return { deletionId, status: 'removed' };
  } catch (error) {
    console.error('❌ Error deleting deletion record:', error);
    throw error;
  }
};

/**
 * Get a specific deletion record by ID
 */
export const getDeletionById = async (deletionId) => {
  if (!deletionId) {
    throw new Error('deletionId is required');
  }

  const params = {
    TableName: DELETION_HISTORY_TABLE,
    Key: { deletionId: deletionId }
  };

  try {
    const result = await dynamoDB.get(params).promise();
    if (result.Item) {
      console.log('✅ Retrieved deletion record:', deletionId);
      return result.Item;
    }
    console.log('⚠️ Deletion record not found:', deletionId);
    return null;
  } catch (error) {
    console.error('❌ Error retrieving deletion record:', error);
    throw error;
  }
};

/**
 * Get statistics about deletions in a workspace
 */
export const getDeletionStatistics = async (workspaceId) => {
  if (!workspaceId) {
    throw new Error('workspaceId is required');
  }

  try {
    const deletions = await getWorkspaceDeletionHistory(workspaceId, 1000);
    
    const stats = {
      totalDeletions: deletions.length,
      byElementType: {},
      byDeletedBy: {},
      byDeletedVia: {},
      mostRecentDeletions: deletions.slice(0, 10),
      deletionTrend: {
        last24Hours: 0,
        last7Days: 0,
        last30Days: 0
      }
    };

    const now = new Date();
    const oneDay = 24 * 60 * 60 * 1000;
    const sevenDays = 7 * oneDay;
    const thirtyDays = 30 * oneDay;

    deletions.forEach(deletion => {
      // Count by element type
      const type = deletion.elementType || 'unknown';
      stats.byElementType[type] = (stats.byElementType[type] || 0) + 1;

      // Count by deleted by
      const deletedBy = deletion.deletedByEmail || deletion.deletedBy || 'unknown';
      stats.byDeletedBy[deletedBy] = (stats.byDeletedBy[deletedBy] || 0) + 1;

      // Count by deletion method
      const method = deletion.details?.deletedVia || 'unknown';
      stats.byDeletedVia[method] = (stats.byDeletedVia[method] || 0) + 1;

      // Time-based statistics
      const deletionTime = new Date(deletion.deletedAt).getTime();
      const timeDiff = now.getTime() - deletionTime;

      if (timeDiff < oneDay) stats.deletionTrend.last24Hours++;
      if (timeDiff < sevenDays) stats.deletionTrend.last7Days++;
      if (timeDiff < thirtyDays) stats.deletionTrend.last30Days++;
    });

    console.log('✅ Deletion statistics calculated for workspace:', workspaceId);
    return stats;
  } catch (error) {
    console.error('❌ Error calculating deletion statistics:', error);
    throw error;
  }
};
