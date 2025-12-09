import { dynamoDB, POST_SERVICES_NOTIFICATIONS_TABLE } from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

// Create a new notification entry
export const createNotification = async (notificationData) => {
  const notificationId = uuidv4();
  const now = new Date().toISOString();

  const params = {
    TableName: POST_SERVICES_NOTIFICATIONS_TABLE,
    Item: {
      notificationId: notificationId,
      userId: notificationData.userId,
      senderId: notificationData.senderId,
      senderName: notificationData.senderName,
      type: notificationData.type,
      message: notificationData.message,
      postId: notificationData.postId,
      link: notificationData.link,
      isRead: false,
      createdAt: now,
    },
  };

  try {
    await dynamoDB.put(params).promise();
    return params.Item;
  } catch (error) {
    console.error('Error creating notification in DynamoDB:', error);
    throw error;
  }
};

// Get notifications for a specific user
export const getNotificationsByUserId = async (userId, limit = 50, lastEvaluatedKey = null) => {
  const params = {
    TableName: POST_SERVICES_NOTIFICATIONS_TABLE,
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId,
    },
    Limit: limit,
    ScanIndexForward: false, // Most recent first
  };

  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }

  try {
    const result = await dynamoDB.query(params).promise();
    return {
      notifications: result.Items || [],
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  } catch (error) {
    console.error('Error getting notifications by user ID from DynamoDB:', error);
    throw error;
  }
};

// Mark a notification as read
export const markNotificationAsRead = async (notificationId, userId) => {
  const params = {
    TableName: POST_SERVICES_NOTIFICATIONS_TABLE,
    Key: {
      userId: userId,
      notificationId: notificationId,
    },
    UpdateExpression: 'set isRead = :isRead',
    ExpressionAttributeValues: {
      ':isRead': true,
    },
    ReturnValues: 'ALL_NEW',
  };

  try {
    const result = await dynamoDB.update(params).promise();
    return result.Attributes;
  } catch (error) {
    console.error('Error marking notification as read in DynamoDB:', error);
    throw error;
  }
};

// Get unread notifications count for a user
export const getUnreadNotificationsCount = async (userId) => {
  const params = {
    TableName: POST_SERVICES_NOTIFICATIONS_TABLE,
    IndexName: 'UnreadNotificationsIndex',
    KeyConditionExpression: 'userId = :userId AND isRead = :isRead',
    ExpressionAttributeValues: {
      ':userId': userId,
      ':isRead': false,
    },
    Select: 'COUNT',
  };

  try {
    const result = await dynamoDB.query(params).promise();
    return result.Count;
  } catch (error) {
    console.error('Error getting unread notifications count from DynamoDB:', error);
    throw error;
  }
};

