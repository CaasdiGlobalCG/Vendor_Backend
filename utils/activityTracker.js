import * as DynamoActivity from '../models/DynamoActivity.js';

// Activity tracking utility
class ActivityTracker {
  constructor() {
    this.isEnabled = true;
  }

  // Enable/disable activity tracking
  setEnabled(enabled) {
    this.isEnabled = enabled;
  }

  // Track a generic activity
  async track(activityData) {
    if (!this.isEnabled) return null;

    try {
      return await DynamoActivity.createActivity(activityData);
    } catch (error) {
      console.error('❌ ActivityTracker: Failed to track activity:', error);
      return null;
    }
  }

  // Track task-related activities
  async trackTaskActivity(workspaceId, taskId, userId, userEmail, userName, action, details = {}) {
    return this.track({
      workspaceId,
      taskId,
      userId,
      userEmail,
      userName,
      action,
      actionType: this.getActionType(action),
      targetType: 'task',
      targetId: taskId,
      details
    });
  }

  // Track subtask-related activities
  async trackSubtaskActivity(workspaceId, taskId, subtaskId, userId, userEmail, userName, action, details = {}) {
    return this.track({
      workspaceId,
      taskId,
      subtaskId,
      userId,
      userEmail,
      userName,
      action,
      actionType: this.getActionType(action),
      targetType: 'subtask',
      targetId: subtaskId,
      details
    });
  }

  // Track canvas element activities
  async trackElementActivity(workspaceId, taskId, subtaskId, userId, userEmail, userName, action, elementData) {
    const { elementId, elementType, position, oldValue, newValue } = elementData;

    return this.track({
      workspaceId,
      taskId,
      subtaskId,
      userId,
      userEmail,
      userName,
      action,
      actionType: this.getActionType(action),
      targetType: 'element',
      targetId: elementId,
      elementType,
      position,
      oldValue,
      newValue,
      details: {
        elementType,
        elementId,
        canvasAction: true
      }
    });
  }

  // Track file-related activities
  async trackFileActivity(workspaceId, taskId, subtaskId, userId, userEmail, userName, action, fileInfo) {
    return this.track({
      workspaceId,
      taskId,
      subtaskId,
      userId,
      userEmail,
      userName,
      action,
      actionType: this.getActionType(action),
      targetType: 'file',
      targetId: fileInfo.fileId,
      fileInfo,
      details: {
        fileName: fileInfo.fileName,
        fileSize: fileInfo.fileSize,
        fileType: fileInfo.fileType
      }
    });
  }

  // Track style/formatting changes
  async trackStyleActivity(workspaceId, taskId, subtaskId, userId, userEmail, userName, elementId, styleChanges) {
    return this.track({
      workspaceId,
      taskId,
      subtaskId,
      userId,
      userEmail,
      userName,
      action: 'style_changed',
      actionType: 'style',
      targetType: 'element',
      targetId: elementId,
      oldValue: styleChanges.oldStyles,
      newValue: styleChanges.newStyles,
      details: {
        styleType: styleChanges.styleType,
        properties: styleChanges.properties
      }
    });
  }

  // Track canvas operations (zoom, pan, etc.)
  async trackCanvasActivity(workspaceId, taskId, subtaskId, userId, userEmail, userName, action, canvasData) {
    return this.track({
      workspaceId,
      taskId,
      subtaskId,
      userId,
      userEmail,
      userName,
      action,
      actionType: 'canvas',
      targetType: 'canvas',
      details: canvasData
    });
  }

  // Track collaboration activities
  async trackCollaborationActivity(workspaceId, taskId, subtaskId, userId, userEmail, userName, action, collaborationData) {
    return this.track({
      workspaceId,
      taskId,
      subtaskId,
      userId,
      userEmail,
      userName,
      action,
      actionType: 'collaboration',
      targetType: 'workspace',
      details: collaborationData
    });
  }

  // Helper method to determine action type from action string
  getActionType(action) {
    const actionTypeMap = {
      // Create actions
      'task_created': 'create',
      'subtask_created': 'create',
      'element_added': 'create',
      'file_uploaded': 'create',
      'comment_added': 'create',

      // Update actions
      'task_updated': 'update',
      'subtask_updated': 'update',
      'element_modified': 'update',
      'text_changed': 'update',
      'style_changed': 'update',
      'position_changed': 'update',
      'file_renamed': 'update',

      // Delete actions
      'task_deleted': 'delete',
      'subtask_deleted': 'delete',
      'element_removed': 'delete',
      'file_deleted': 'delete',
      'comment_deleted': 'delete',

      // Move actions
      'element_moved': 'move',
      'task_moved': 'move',
      'file_moved': 'move',

      // Canvas actions
      'canvas_zoomed': 'canvas',
      'canvas_panned': 'canvas',
      'canvas_cleared': 'canvas',
      'layout_changed': 'canvas',

      // Collaboration actions
      'user_joined': 'collaboration',
      'user_left': 'collaboration',
      'workspace_shared': 'collaboration',
      'permission_changed': 'collaboration'
    };

    return actionTypeMap[action] || 'update';
  }

  // Batch track multiple activities
  async trackBatch(activities) {
    if (!this.isEnabled) return [];

    const results = [];
    for (const activityData of activities) {
      try {
        const activity = await this.track(activityData);
        results.push(activity);
      } catch (error) {
        console.error('❌ ActivityTracker: Failed to track batch activity:', error);
        results.push(null);
      }
    }
    return results;
  }

  // Get human-readable action descriptions
  getActionDescription(activity) {
    const descriptions = {
      'task_created': `created task "${activity.details.taskName || 'Untitled'}"`,
      'task_updated': `updated task "${activity.details.taskName || 'Untitled'}"`,
      'task_deleted': `deleted task "${activity.details.taskName || 'Untitled'}"`,
      'subtask_created': `created subtask "${activity.details.subtaskName || 'Untitled'}"`,
      'subtask_updated': `updated subtask "${activity.details.subtaskName || 'Untitled'}"`,
      'subtask_deleted': `deleted subtask "${activity.details.subtaskName || 'Untitled'}"`,
      'element_added': `added ${activity.elementType || 'element'} to canvas`,
      'element_modified': `modified ${activity.elementType || 'element'} on canvas`,
      'element_removed': `removed ${activity.elementType || 'element'} from canvas`,
      'element_moved': `moved ${activity.elementType || 'element'} on canvas`,
      'text_changed': `changed text content`,
      'style_changed': `updated styling`,
      'file_uploaded': `uploaded file "${activity.fileInfo?.fileName || 'Unknown'}"`,
      'file_deleted': `deleted file "${activity.fileInfo?.fileName || 'Unknown'}"`,
      'canvas_zoomed': `zoomed canvas to ${activity.details.zoomLevel || '100'}%`,
      'canvas_cleared': `cleared the canvas`,
      'user_joined': `joined the workspace`,
      'user_left': `left the workspace`,
      'workspace_shared': `shared workspace with others`
    };

    return descriptions[activity.action] || activity.action.replace(/_/g, ' ');
  }
}

// Export singleton instance
export default new ActivityTracker();
