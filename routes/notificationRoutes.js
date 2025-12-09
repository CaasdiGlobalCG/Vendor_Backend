import express from 'express';
import {
    getNotificationsForUser,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification
} from '../models/DynamoNotification.js';

const router = express.Router();

// Get notifications for a user
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { userType = 'vendor', includeRead = 'false' } = req.query;
        
        console.log(`notificationRoutes - GET /:userId - Fetching notifications for ${userType} ${userId}, includeRead: ${includeRead}`);
        
        const notifications = await getNotificationsForUser(
            userId, 
            userType, 
            { includeRead: includeRead === 'true' }
        );
        
        console.log(`notificationRoutes - GET /:userId - Found ${notifications.count} notifications`);
        res.json(notifications);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ message: 'Error fetching notifications', error: error.message });
    }
});

// Mark a notification as read
router.put('/:notificationId/read', async (req, res) => {
    try {
        const { notificationId } = req.params;
        
        console.log(`notificationRoutes - PUT /:notificationId/read - Marking notification ${notificationId} as read`);
        
        const updatedNotification = await markNotificationAsRead(notificationId);
        
        console.log(`notificationRoutes - PUT /:notificationId/read - Successfully marked notification as read`);
        res.json(updatedNotification);
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ message: 'Error marking notification as read', error: error.message });
    }
});

// Mark all notifications as read for a user
router.put('/:userId/read-all', async (req, res) => {
    try {
        const { userId } = req.params;
        const { userType = 'vendor' } = req.query;
        
        console.log(`notificationRoutes - PUT /:userId/read-all - Marking all notifications as read for ${userType} ${userId}`);
        
        const result = await markAllNotificationsAsRead(userId, userType);
        
        console.log(`notificationRoutes - PUT /:userId/read-all - Marked ${result.count} notifications as read`);
        res.json(result);
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ message: 'Error marking all notifications as read', error: error.message });
    }
});

// Delete a notification
router.delete('/:notificationId', async (req, res) => {
    try {
        const { notificationId } = req.params;
        
        console.log(`notificationRoutes - DELETE /:notificationId - Deleting notification ${notificationId}`);
        
        const result = await deleteNotification(notificationId);
        
        console.log(`notificationRoutes - DELETE /:notificationId - Successfully deleted notification`);
        res.json(result);
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ message: 'Error deleting notification', error: error.message });
    }
});

export default router; 