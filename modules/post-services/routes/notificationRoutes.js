import express from 'express';
import * as notificationController from '../controllers/notificationController.js';
import { authenticateUser } from '../../../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/notifications/:userId - Get all notifications for a user
router.get('/notifications/:userId', authenticateUser, notificationController.getUserNotifications);

// PUT /api/notifications/:notificationId/:userId/read - Mark a specific notification as read
router.put('/notifications/:notificationId/:userId/read', authenticateUser, notificationController.markNotificationAsRead);

// GET /api/notifications/:userId/unread-count - Get unread notifications count for a user
router.get('/notifications/:userId/unread-count', authenticateUser, notificationController.getUnreadNotificationsCount);

// PUT /api/notifications/:userId/read-all - Mark all notifications as read for a user
router.put('/notifications/:userId/read-all', authenticateUser, notificationController.markAllNotificationsAsRead);

export default router;
