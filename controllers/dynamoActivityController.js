import * as DynamoActivity from '../models/DynamoActivity.js';

// Create a new activity
export const createActivity = async (req, res) => {
  try {
    const {
      workspaceId,
      taskId,
      subtaskId,
      userId,
      userEmail,
      userName,
      action,
      actionType,
      targetType,
      targetId,
      details,
      elementType,
      oldValue,
      newValue,
      position,
      fileInfo
    } = req.body;

    console.log('🔄 Backend: Creating activity', {
      workspaceId,
      action,
      actionType,
      targetType,
      userName
    });

    if (!workspaceId || !userId || !action || !actionType || !targetType) {
      return res.status(400).json({
        message: 'Missing required fields: workspaceId, userId, action, actionType, targetType'
      });
    }

    const activityData = {
      workspaceId,
      taskId,
      subtaskId,
      userId,
      userEmail,
      userName,
      action,
      actionType,
      targetType,
      targetId,
      details,
      elementType,
      oldValue,
      newValue,
      position,
      fileInfo,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    };

    const activity = await DynamoActivity.createActivity(activityData);

    console.log('✅ Backend: Activity created successfully', { activityId: activity.activityId });

    res.status(201).json({
      message: 'Activity created successfully',
      activity
    });
  } catch (error) {
    console.error('❌ Backend: Error creating activity:', error);
    res.status(500).json({
      message: 'Failed to create activity',
      error: error.message
    });
  }
};

// Get activities for a workspace
export const getWorkspaceActivities = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const {
      taskId,
      subtaskId,
      userId,
      actionType,
      targetType,
      startDate,
      endDate,
      limit,
      lastEvaluatedKey
    } = req.query;

    console.log('🔄 Backend: Getting workspace activities', {
      workspaceId,
      filters: { taskId, subtaskId, userId, actionType, targetType, startDate, endDate }
    });

    const filters = {
      taskId,
      subtaskId,
      userId,
      actionType,
      targetType,
      startDate,
      endDate,
      limit: limit ? parseInt(limit) : 50,
      lastEvaluatedKey: lastEvaluatedKey ? JSON.parse(lastEvaluatedKey) : null
    };

    const result = await DynamoActivity.getActivitiesByWorkspace(workspaceId, filters);

    console.log('✅ Backend: Retrieved activities', {
      count: result.activities.length,
      hasMore: !!result.lastEvaluatedKey
    });

    res.status(200).json({
      message: 'Activities retrieved successfully',
      ...result
    });
  } catch (error) {
    console.error('❌ Backend: Error getting activities:', error);
    res.status(500).json({
      message: 'Failed to get activities',
      error: error.message
    });
  }
};

// Get activities grouped by date
export const getActivitiesGroupedByDate = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const {
      taskId,
      subtaskId,
      userId,
      actionType,
      targetType,
      startDate,
      endDate,
      limit
    } = req.query;

    console.log('🔄 Backend: Getting activities grouped by date', { 
      workspaceId,
      filters: { taskId, subtaskId, userId, actionType, targetType, startDate, endDate, limit }
    });

    const filters = {
      taskId,
      subtaskId,
      userId,
      actionType,
      targetType,
      startDate,
      endDate,
      limit: limit ? parseInt(limit) : 100
    };

    const result = await DynamoActivity.getActivitiesGroupedByDate(workspaceId, filters);

    console.log('✅ Backend: Retrieved grouped activities', {
      dateCount: Object.keys(result.activitiesByDate).length,
      totalActivities: result.totalCount,
      dates: Object.keys(result.activitiesByDate),
      sampleActivity: Object.values(result.activitiesByDate)[0]?.[0]
    });

    res.status(200).json({
      message: 'Grouped activities retrieved successfully',
      ...result
    });
  } catch (error) {
    console.error('❌ Backend: Error getting grouped activities:', error);
    res.status(500).json({
      message: 'Failed to get grouped activities',
      error: error.message
    });
  }
};

// Get recent activities
export const getRecentActivities = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { limit } = req.query;

    console.log('🔄 Backend: Getting recent activities', { workspaceId });

    const activities = await DynamoActivity.getRecentActivities(
      workspaceId,
      limit ? parseInt(limit) : 10
    );

    console.log('✅ Backend: Retrieved recent activities', { count: activities.length });

    res.status(200).json({
      message: 'Recent activities retrieved successfully',
      activities
    });
  } catch (error) {
    console.error('❌ Backend: Error getting recent activities:', error);
    res.status(500).json({
      message: 'Failed to get recent activities',
      error: error.message
    });
  }
};

// Get activity statistics
export const getActivityStats = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { days } = req.query;

    console.log('🔄 Backend: Getting activity stats', { workspaceId, days });

    const stats = await DynamoActivity.getActivityStats(
      workspaceId,
      days ? parseInt(days) : 7
    );

    console.log('✅ Backend: Retrieved activity stats', {
      totalActivities: stats.totalActivities,
      mostActiveUser: stats.mostActiveUser
    });

    res.status(200).json({
      message: 'Activity stats retrieved successfully',
      stats
    });
  } catch (error) {
    console.error('❌ Backend: Error getting activity stats:', error);
    res.status(500).json({
      message: 'Failed to get activity stats',
      error: error.message
    });
  }
};

// Bulk create activities (for batch operations)
export const createBulkActivities = async (req, res) => {
  try {
    const { activities } = req.body;

    console.log('🔄 Backend: Creating bulk activities', { count: activities.length });

    if (!Array.isArray(activities) || activities.length === 0) {
      return res.status(400).json({
        message: 'Activities array is required and must not be empty'
      });
    }

    const createdActivities = [];
    const errors = [];

    for (const activityData of activities) {
      try {
        const activity = await DynamoActivity.createActivity({
          ...activityData,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        });
        createdActivities.push(activity);
      } catch (error) {
        errors.push({
          activityData,
          error: error.message
        });
      }
    }

    console.log('✅ Backend: Bulk activities created', {
      successful: createdActivities.length,
      failed: errors.length
    });

    res.status(201).json({
      message: 'Bulk activities processed',
      successful: createdActivities.length,
      failed: errors.length,
      createdActivities,
      errors
    });
  } catch (error) {
    console.error('❌ Backend: Error creating bulk activities:', error);
    res.status(500).json({
      message: 'Failed to create bulk activities',
      error: error.message
    });
  }
};

// Helper function to track activity (can be called from other controllers)
export const trackActivity = async (activityData) => {
  try {
    const activity = await DynamoActivity.createActivity(activityData);
    console.log('📝 Activity tracked:', activity.action);
    return activity;
  } catch (error) {
    console.error('❌ Error tracking activity:', error);
    // Don't throw error to avoid breaking main functionality
    return null;
  }
};
