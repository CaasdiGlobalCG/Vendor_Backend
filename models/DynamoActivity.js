import { dynamoDB, WORKSPACES_TABLE } from '../config/aws.js';

const ACTIVITIES_TABLE = 'workspace_activities';

// Create a new activity record
export const createActivity = async (activityData) => {
  const activity = {
    activityId: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    workspaceId: activityData.workspaceId,
    taskId: activityData.taskId || null,
    subtaskId: activityData.subtaskId || null,
    userId: activityData.userId,
    userEmail: activityData.userEmail,
    userName: activityData.userName,
    action: activityData.action, // 'task_created', 'element_added', 'text_changed', etc.
    actionType: activityData.actionType, // 'create', 'update', 'delete', 'move', 'style'
    targetType: activityData.targetType, // 'task', 'subtask', 'element', 'canvas', 'file'
    targetId: activityData.targetId || null,
    details: activityData.details || {}, // Additional context about the change
    metadata: {
      elementType: activityData.elementType || null, // 'rectangle', 'text', 'flowchart'
      oldValue: activityData.oldValue || null,
      newValue: activityData.newValue || null,
      position: activityData.position || null,
      fileInfo: activityData.fileInfo || null
    },
    timestamp: new Date().toISOString(),
    date: new Date().toISOString().split('T')[0], // YYYY-MM-DD for easy filtering
    ipAddress: activityData.ipAddress || null,
    userAgent: activityData.userAgent || null
  };

  const params = {
    TableName: ACTIVITIES_TABLE,
    Item: activity
  };

  try {
    await dynamoDB.put(params).promise();
    console.log('✅ Activity created:', activity.activityId);
    return activity;
  } catch (error) {
    console.error('❌ Error creating activity:', error);
    throw error;
  }
};

// Get activities for a workspace with optional filters
export const getActivitiesByWorkspace = async (workspaceId, filters = {}) => {
  const {
    taskId,
    subtaskId,
    userId,
    actionType,
    targetType,
    startDate,
    endDate,
    limit = 50,
    lastEvaluatedKey
  } = filters;

  let filterExpression = 'workspaceId = :workspaceId';
  let expressionAttributeValues = {
    ':workspaceId': workspaceId
  };

  // Add optional filters
  if (taskId) {
    filterExpression += ' AND taskId = :taskId';
    expressionAttributeValues[':taskId'] = taskId;
  }

  if (subtaskId) {
    filterExpression += ' AND subtaskId = :subtaskId';
    expressionAttributeValues[':subtaskId'] = subtaskId;
  }

  if (userId) {
    filterExpression += ' AND userId = :userId';
    expressionAttributeValues[':userId'] = userId;
  }

  if (actionType) {
    filterExpression += ' AND actionType = :actionType';
    expressionAttributeValues[':actionType'] = actionType;
  }

  if (targetType) {
    filterExpression += ' AND targetType = :targetType';
    expressionAttributeValues[':targetType'] = targetType;
  }

  if (startDate) {
    filterExpression += ' AND #date >= :startDate';
    expressionAttributeValues[':startDate'] = startDate;
  }

  if (endDate) {
    filterExpression += ' AND #date <= :endDate';
    expressionAttributeValues[':endDate'] = endDate;
  }

  const params = {
    TableName: ACTIVITIES_TABLE,
    IndexName: 'WorkspaceIndex',
    KeyConditionExpression: 'workspaceId = :workspaceId',
    ExpressionAttributeValues: {
      ':workspaceId': workspaceId
    },
    Limit: limit,
    ScanIndexForward: false // Most recent first
  };

  // Add additional filters if provided
  if (taskId || subtaskId || userId || actionType || targetType || startDate || endDate) {
    let filterExpression = '';
    const filterValues = {};
    const filterNames = {};

    if (taskId) {
      filterExpression += (filterExpression ? ' AND ' : '') + 'taskId = :taskId';
      filterValues[':taskId'] = taskId;
    }

    if (subtaskId) {
      filterExpression += (filterExpression ? ' AND ' : '') + 'subtaskId = :subtaskId';
      filterValues[':subtaskId'] = subtaskId;
    }

    if (userId) {
      filterExpression += (filterExpression ? ' AND ' : '') + 'userId = :userId';
      filterValues[':userId'] = userId;
    }

    if (actionType) {
      filterExpression += (filterExpression ? ' AND ' : '') + 'actionType = :actionType';
      filterValues[':actionType'] = actionType;
    }

    if (targetType) {
      filterExpression += (filterExpression ? ' AND ' : '') + 'targetType = :targetType';
      filterValues[':targetType'] = targetType;
    }

    if (startDate) {
      filterExpression += (filterExpression ? ' AND ' : '') + '#date >= :startDate';
      filterValues[':startDate'] = startDate;
      filterNames['#date'] = 'date';
    }

    if (endDate) {
      filterExpression += (filterExpression ? ' AND ' : '') + '#date <= :endDate';
      filterValues[':endDate'] = endDate;
      filterNames['#date'] = 'date';
    }

    if (filterExpression) {
      params.FilterExpression = filterExpression;
      params.ExpressionAttributeValues = { ...params.ExpressionAttributeValues, ...filterValues };
      if (Object.keys(filterNames).length > 0) {
        params.ExpressionAttributeNames = filterNames;
      }
    }
  }

  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }

  try {
    const result = await dynamoDB.query(params).promise();
    
    // Sort by timestamp descending (most recent first)
    const sortedActivities = result.Items.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    return {
      activities: sortedActivities,
      lastEvaluatedKey: result.LastEvaluatedKey,
      count: result.Count
    };
  } catch (error) {
    console.error('❌ Error getting activities:', error);
    throw error;
  }
};

// Get activities grouped by date
export const getActivitiesGroupedByDate = async (workspaceId, filters = {}) => {
  // Increase limit for grouping to get more comprehensive data
  const result = await getActivitiesByWorkspace(workspaceId, { ...filters, limit: filters.limit || 200 });
  
  console.log('📊 Grouping activities by date:', {
    totalActivities: result.activities.length,
    workspaceId
  });
  
  const groupedActivities = result.activities.reduce((groups, activity) => {
    const date = activity.date;
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(activity);
    return groups;
  }, {});

  // Sort dates in descending order
  const sortedDates = Object.keys(groupedActivities).sort((a, b) => new Date(b) - new Date(a));
  
  const sortedGroupedActivities = {};
  sortedDates.forEach(date => {
    sortedGroupedActivities[date] = groupedActivities[date];
  });

  console.log('📅 Activities grouped by date:', {
    dateCount: sortedDates.length,
    dates: sortedDates
  });

  return {
    activitiesByDate: sortedGroupedActivities,
    totalCount: result.count,
    lastEvaluatedKey: result.lastEvaluatedKey
  };
};

// Get recent activities (last 24 hours)
export const getRecentActivities = async (workspaceId, limit = 10) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  const filters = {
    startDate: yesterday.toISOString().split('T')[0],
    limit
  };

  const result = await getActivitiesByWorkspace(workspaceId, filters);
  return result.activities;
};

// Get activity statistics
export const getActivityStats = async (workspaceId, days = 7) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const filters = {
    startDate: startDate.toISOString().split('T')[0],
    limit: 1000 // Get more for stats
  };

  const result = await getActivitiesByWorkspace(workspaceId, filters);
  const activities = result.activities;

  const stats = {
    totalActivities: activities.length,
    activitiesByType: {},
    activitiesByUser: {},
    activitiesByDate: {},
    mostActiveUser: null,
    mostCommonAction: null
  };

  activities.forEach(activity => {
    // Count by action type
    stats.activitiesByType[activity.actionType] = (stats.activitiesByType[activity.actionType] || 0) + 1;
    
    // Count by user
    stats.activitiesByUser[activity.userName] = (stats.activitiesByUser[activity.userName] || 0) + 1;
    
    // Count by date
    stats.activitiesByDate[activity.date] = (stats.activitiesByDate[activity.date] || 0) + 1;
  });

  // Find most active user
  stats.mostActiveUser = Object.keys(stats.activitiesByUser).reduce((a, b) => 
    stats.activitiesByUser[a] > stats.activitiesByUser[b] ? a : b, ''
  );

  // Find most common action
  stats.mostCommonAction = Object.keys(stats.activitiesByType).reduce((a, b) => 
    stats.activitiesByType[a] > stats.activitiesByType[b] ? a : b, ''
  );

  return stats;
};

// Delete old activities (cleanup function)
export const deleteOldActivities = async (workspaceId, daysToKeep = 90) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  const params = {
    TableName: ACTIVITIES_TABLE,
    FilterExpression: 'workspaceId = :workspaceId AND #date < :cutoffDate',
    ExpressionAttributeValues: {
      ':workspaceId': workspaceId,
      ':cutoffDate': cutoffDate.toISOString().split('T')[0]
    },
    ExpressionAttributeNames: {
      '#date': 'date'
    }
  };

  try {
    const result = await dynamoDB.scan(params).promise();
    
    // Delete in batches
    const deletePromises = result.Items.map(item => {
      return dynamoDB.delete({
        TableName: ACTIVITIES_TABLE,
        Key: { activityId: item.activityId }
      }).promise();
    });

    await Promise.all(deletePromises);
    console.log(`✅ Deleted ${result.Items.length} old activities for workspace ${workspaceId}`);
    
    return result.Items.length;
  } catch (error) {
    console.error('❌ Error deleting old activities:', error);
    throw error;
  }
};

export { ACTIVITIES_TABLE };
