import express from 'express';
import * as dynamoWorkspaceMessageController from '../controllers/dynamoWorkspaceMessageController.js';

const router = express.Router();

// Create a new message
router.post('/workspace-messages', dynamoWorkspaceMessageController.createMessage);

// Get messages for a specific workspace
router.get('/workspace-messages/workspace/:workspaceId', dynamoWorkspaceMessageController.getWorkspaceMessages);

// Get recent messages across multiple workspaces
router.post('/workspace-messages/recent', dynamoWorkspaceMessageController.getRecentMessages);

// Get message by ID
router.get('/workspace-messages/:messageId', dynamoWorkspaceMessageController.getMessageById);

// Update a message
router.put('/workspace-messages/:messageId', dynamoWorkspaceMessageController.updateMessage);

// Delete a message (soft delete)
router.delete('/workspace-messages/:messageId', dynamoWorkspaceMessageController.deleteMessage);

// Add reaction to message
router.post('/workspace-messages/:messageId/reactions', dynamoWorkspaceMessageController.addReaction);

export default router;
