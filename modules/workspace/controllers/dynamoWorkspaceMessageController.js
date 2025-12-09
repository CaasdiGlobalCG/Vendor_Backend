import * as DynamoWorkspaceMessage from '../models/DynamoWorkspaceMessage.js';

// Create a new message
export const createMessage = async (req, res) => {
  try {
    const messageData = req.body;
    
    // Validate required fields
    if (!messageData.workspaceId || !messageData.content || !messageData.senderId) {
      return res.status(400).json({ 
        message: 'Missing required fields: workspaceId, content, senderId' 
      });
    }

    console.log('💬 dynamoWorkspaceMessageController: Creating message for workspace:', messageData.workspaceId);

    const message = await DynamoWorkspaceMessage.createMessage(messageData);
    
    console.log('✅ dynamoWorkspaceMessageController: Message created successfully:', message.messageId);
    res.status(201).json(message);
  } catch (error) {
    console.error('❌ dynamoWorkspaceMessageController: Error creating message:', error);
    res.status(500).json({ message: 'Failed to create message', error: error.message });
  }
};

// Get messages for a workspace
export const getWorkspaceMessages = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { limit = 50, lastEvaluatedKey } = req.query;

    console.log(`💬 dynamoWorkspaceMessageController: Getting messages for workspace ${workspaceId}...`);

    const result = await DynamoWorkspaceMessage.getMessagesByWorkspace(
      workspaceId, 
      parseInt(limit), 
      lastEvaluatedKey ? JSON.parse(lastEvaluatedKey) : null
    );

    console.log(`✅ dynamoWorkspaceMessageController: Retrieved ${result.messages.length} messages`);
    res.status(200).json(result);
  } catch (error) {
    console.error('❌ dynamoWorkspaceMessageController: Error getting workspace messages:', error);
    res.status(500).json({ message: 'Failed to get messages', error: error.message });
  }
};

// Get recent messages across multiple workspaces
export const getRecentMessages = async (req, res) => {
  try {
    const { workspaceIds } = req.body; // Array of workspace IDs
    const { limit = 10 } = req.query;

    if (!workspaceIds || !Array.isArray(workspaceIds)) {
      return res.status(400).json({ 
        message: 'workspaceIds array is required in request body' 
      });
    }

    console.log(`💬 dynamoWorkspaceMessageController: Getting recent messages for ${workspaceIds.length} workspaces...`);

    const messages = await DynamoWorkspaceMessage.getRecentMessages(workspaceIds, parseInt(limit));

    console.log(`✅ dynamoWorkspaceMessageController: Retrieved ${messages.length} recent messages`);
    res.status(200).json(messages);
  } catch (error) {
    console.error('❌ dynamoWorkspaceMessageController: Error getting recent messages:', error);
    res.status(500).json({ message: 'Failed to get recent messages', error: error.message });
  }
};

// Get message by ID
export const getMessageById = async (req, res) => {
  try {
    const { messageId } = req.params;

    console.log(`💬 dynamoWorkspaceMessageController: Getting message ${messageId}...`);

    const message = await DynamoWorkspaceMessage.getMessageById(messageId);

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    console.log('✅ dynamoWorkspaceMessageController: Message retrieved successfully');
    res.status(200).json(message);
  } catch (error) {
    console.error('❌ dynamoWorkspaceMessageController: Error getting message:', error);
    res.status(500).json({ message: 'Failed to get message', error: error.message });
  }
};

// Update a message
export const updateMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const updateData = req.body;

    console.log(`💬 dynamoWorkspaceMessageController: Updating message ${messageId}...`);

    const updatedMessage = await DynamoWorkspaceMessage.updateMessage(messageId, updateData);

    console.log('✅ dynamoWorkspaceMessageController: Message updated successfully');
    res.status(200).json(updatedMessage);
  } catch (error) {
    console.error('❌ dynamoWorkspaceMessageController: Error updating message:', error);
    res.status(500).json({ message: 'Failed to update message', error: error.message });
  }
};

// Delete a message (soft delete)
export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;

    console.log(`💬 dynamoWorkspaceMessageController: Deleting message ${messageId}...`);

    await DynamoWorkspaceMessage.deleteMessage(messageId);

    console.log('✅ dynamoWorkspaceMessageController: Message deleted successfully');
    res.status(200).json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('❌ dynamoWorkspaceMessageController: Error deleting message:', error);
    res.status(500).json({ message: 'Failed to delete message', error: error.message });
  }
};

// Add reaction to message
export const addReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId, reaction } = req.body;

    if (!userId || !reaction) {
      return res.status(400).json({ 
        message: 'Missing required fields: userId, reaction' 
      });
    }

    console.log(`💬 dynamoWorkspaceMessageController: Adding reaction to message ${messageId}...`);

    const updatedMessage = await DynamoWorkspaceMessage.addReaction(messageId, userId, reaction);

    console.log('✅ dynamoWorkspaceMessageController: Reaction added successfully');
    res.status(200).json(updatedMessage);
  } catch (error) {
    console.error('❌ dynamoWorkspaceMessageController: Error adding reaction:', error);
    res.status(500).json({ message: 'Failed to add reaction', error: error.message });
  }
};
