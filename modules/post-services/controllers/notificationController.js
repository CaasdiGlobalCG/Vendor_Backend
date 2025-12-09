import * as DynamoNotification from '../models/DynamoNotification.js';

// Get notifications for a specific user
export const getUserNotifications = async (req, res) => {
  const { userId } = req.params;
  const { limit = 50, lastEvaluatedKey } = req.query;

  if (!userId) {
    return res.status(400).send({ message: 'User ID is required.' });
  }

  try {
    const result = await DynamoNotification.getNotificationsByUserId(
      userId, 
      parseInt(limit), 
      lastEvaluatedKey
    );
    res.status(200).send(result);
  } catch (error) {
    console.error('Failed to get user notifications:', error);
    res.status(500).send({ 
      message: 'Failed to retrieve notifications.', 
      error: error.message 
    });
  }
};

// Mark a notification as read
export const markNotificationAsRead = async (req, res) => {
  const { notificationId, userId } = req.params;

  if (!notificationId || !userId) {
    return res.status(400).send({ 
      message: 'Notification ID and User ID are required.' 
    });
  }

  try {
    const updatedNotification = await DynamoNotification.markNotificationAsRead(
      notificationId, 
      userId
    );
    res.status(200).send(updatedNotification);
  } catch (error) {
    console.error('Failed to mark notification as read:', error);
    res.status(500).send({ 
      message: 'Failed to mark notification as read.', 
      error: error.message 
    });
  }
};

// Get unread notifications count for a user
export const getUnreadNotificationsCount = async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).send({ message: 'User ID is required.' });
  }

  try {
    const count = await DynamoNotification.getUnreadNotificationsCount(userId);
    res.status(200).send({ count });
  } catch (error) {
    console.error('Failed to get unread notifications count:', error);
    res.status(500).send({ 
      message: 'Failed to get unread notifications count.', 
      error: error.message 
    });
  }
};

// Mark all notifications as read for a user
export const markAllNotificationsAsRead = async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).send({ message: 'User ID is required.' });
  }

  try {
    // Get all unread notifications for the user
    const result = await DynamoNotification.getNotificationsByUserId(userId, 1000);
    const unreadNotifications = result.notifications.filter(notification => !notification.isRead);

    // Mark each unread notification as read
    const updatePromises = unreadNotifications.map(notification => 
      DynamoNotification.markNotificationAsRead(notification.notificationId, userId)
    );

    await Promise.all(updatePromises);

    res.status(200).send({ 
      message: `Marked ${unreadNotifications.length} notifications as read.`,
      updatedCount: unreadNotifications.length
    });
  } catch (error) {
    console.error('Failed to mark all notifications as read:', error);
    res.status(500).send({ 
      message: 'Failed to mark all notifications as read.', 
      error: error.message 
    });
  }
};
