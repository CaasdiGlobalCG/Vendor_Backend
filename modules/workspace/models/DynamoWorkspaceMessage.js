import { dynamoDB, WORKSPACE_MESSAGES_TABLE } from '../../../config/aws.js';
import { encryptMessage, decryptMessage } from '../../../utils/kmsEncryption.js';
import { v4 as uuidv4 } from 'uuid';

// Create a workspace message in DynamoDB (with encryption)
export const createMessage = async (messageData) => {
  const id = uuidv4();
  const now = new Date();
  const timestamp = now.toISOString();
  const date = now.toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    console.log('💬 DynamoWorkspaceMessage: Creating message...');

    // Try to encrypt the message content, fallback to plain text if KMS fails
    let contentToStore = messageData.content;
    let isEncrypted = false;
    
    try {
      contentToStore = await encryptMessage(messageData.content);
      isEncrypted = true;
      console.log('🔐 Message encrypted successfully');
    } catch (encryptError) {
      console.warn('⚠️ KMS encryption failed, storing message in plain text:', encryptError.message);
      contentToStore = messageData.content;
      isEncrypted = false;
    }

    const params = {
      TableName: WORKSPACE_MESSAGES_TABLE,
      Item: {
        messageId: id,
        workspaceId: messageData.workspaceId,
        senderId: messageData.senderId,
        senderName: messageData.senderName,
        senderEmail: messageData.senderEmail,
        senderRole: messageData.senderRole || 'vendor', // vendor, client, pm
        content: contentToStore, // Encrypted or plain text message content
        isEncrypted: isEncrypted, // Flag to indicate if content is encrypted
        messageType: messageData.messageType || 'text', // text, file, image, etc.
        timestamp,
        date,
        isEdited: false,
        editedAt: null,
        replyTo: messageData.replyTo || null, // For threaded conversations
        attachments: messageData.attachments || [],
        reactions: messageData.reactions || {},
        isDeleted: false,
        deletedAt: null,
        metadata: messageData.metadata || {} // For additional data like file info, etc.
      }
    };

    await dynamoDB.put(params).promise();

    console.log(`✅ DynamoWorkspaceMessage: Message created successfully (${isEncrypted ? 'encrypted' : 'plain text'})`);

    // Return the message with decrypted content for immediate use
    return {
      ...params.Item,
      content: messageData.content, // Return original content (not encrypted)
      _id: id
    };
  } catch (error) {
    console.error('❌ DynamoWorkspaceMessage: Error creating message:', error);
    throw error;
  }
};

// Get messages by workspace ID (with decryption)
export const getMessagesByWorkspace = async (workspaceId, limit = 50, lastEvaluatedKey = null) => {
  const params = {
    TableName: WORKSPACE_MESSAGES_TABLE,
    IndexName: 'WorkspaceIndex',
    KeyConditionExpression: 'workspaceId = :workspaceId',
    ExpressionAttributeValues: {
      ':workspaceId': workspaceId,
      ':deleted': false
    },
    FilterExpression: 'isDeleted = :deleted',
    Limit: limit,
    ScanIndexForward: true // Oldest first (WhatsApp-like order)
  };

  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }

  try {
    console.log(`💬 DynamoWorkspaceMessage: Getting messages for workspace ${workspaceId}...`);

    const result = await dynamoDB.query(params).promise();
    
    if (!result.Items || result.Items.length === 0) {
      return {
        messages: [],
        lastEvaluatedKey: null
      };
    }

    // Decrypt encrypted messages, keep plain text messages as-is
    console.log(`🔓 DynamoWorkspaceMessage: Processing ${result.Items.length} messages...`);
    
    const processedMessages = await Promise.all(
      result.Items.map(async (message) => {
        try {
          let finalContent = message.content;
          
          // Only decrypt if the message is marked as encrypted
          if (message.isEncrypted) {
            try {
              finalContent = await decryptMessage(message.content);
              console.log(`🔓 Decrypted message: ${message.messageId}`);
            } catch (decryptError) {
              console.error('❌ Error decrypting message:', message.messageId, decryptError);
              finalContent = '[Message could not be decrypted]';
            }
          } else {
            console.log(`📝 Plain text message: ${message.messageId}`);
          }
          
          return {
            ...message,
            content: finalContent,
            _id: message.messageId
          };
        } catch (error) {
          console.error('❌ Error processing message:', message.messageId, error);
          return {
            ...message,
            content: '[Error processing message]',
            _id: message.messageId,
            processingError: true
          };
        }
      })
    );

    console.log('✅ DynamoWorkspaceMessage: Messages retrieved and decrypted successfully');

    return {
      messages: processedMessages,
      lastEvaluatedKey: result.LastEvaluatedKey
    };
  } catch (error) {
    console.error('❌ DynamoWorkspaceMessage: Error getting messages:', error);
    throw error;
  }
};

// Get recent messages for multiple workspaces (for notifications/previews)
export const getRecentMessages = async (workspaceIds, limit = 10) => {
  try {
    console.log(`💬 DynamoWorkspaceMessage: Getting recent messages for ${workspaceIds.length} workspaces...`);

    const allMessages = [];

    // Get recent messages from each workspace
    for (const workspaceId of workspaceIds) {
      const { messages } = await getMessagesByWorkspace(workspaceId, limit);
      allMessages.push(...messages);
    }

    // Sort by timestamp (most recent first) and limit
    const sortedMessages = allMessages
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    console.log('✅ DynamoWorkspaceMessage: Recent messages retrieved successfully');

    return sortedMessages;
  } catch (error) {
    console.error('❌ DynamoWorkspaceMessage: Error getting recent messages:', error);
    throw error;
  }
};

// Update a message (with re-encryption)
export const updateMessage = async (messageId, updateData) => {
  try {
    console.log(`💬 DynamoWorkspaceMessage: Updating message ${messageId}...`);

    // If content is being updated, try to encrypt it
    if (updateData.content) {
      try {
        updateData.content = await encryptMessage(updateData.content);
        updateData.isEncrypted = true;
        console.log('🔐 Updated message encrypted successfully');
      } catch (encryptError) {
        console.warn('⚠️ KMS encryption failed for update, storing in plain text:', encryptError.message);
        updateData.isEncrypted = false;
      }
      updateData.isEdited = true;
      updateData.editedAt = new Date().toISOString();
    }

    // Build update expression
    let updateExpression = 'set';
    const expressionAttributeValues = {};
    const expressionAttributeNames = {};

    Object.entries(updateData).forEach(([key, value], index) => {
      if (key === 'messageId') return;

      const attributeValueKey = `:val${index}`;
      const attributeNameKey = `#attr${index}`;

      updateExpression += ` ${attributeNameKey} = ${attributeValueKey},`;
      expressionAttributeValues[attributeValueKey] = value;
      expressionAttributeNames[attributeNameKey] = key;
    });

    updateExpression = updateExpression.slice(0, -1); // Remove trailing comma

    const params = {
      TableName: WORKSPACE_MESSAGES_TABLE,
      Key: {
        messageId: messageId
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: expressionAttributeNames,
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    console.log('✅ DynamoWorkspaceMessage: Message updated successfully');

    // Decrypt content for response if encrypted
    if (result.Attributes.content && result.Attributes.isEncrypted) {
      try {
        const decryptedContent = await decryptMessage(result.Attributes.content);
        result.Attributes.content = decryptedContent;
      } catch (decryptError) {
        console.error('❌ Error decrypting updated message:', decryptError);
        result.Attributes.content = '[Message could not be decrypted]';
      }
    }

    return {
      ...result.Attributes,
      _id: result.Attributes.messageId
    };
  } catch (error) {
    console.error('❌ DynamoWorkspaceMessage: Error updating message:', error);
    throw error;
  }
};

// Soft delete a message
export const deleteMessage = async (messageId) => {
  try {
    console.log(`💬 DynamoWorkspaceMessage: Soft deleting message ${messageId}...`);

    const params = {
      TableName: WORKSPACE_MESSAGES_TABLE,
      Key: {
        messageId: messageId
      },
      UpdateExpression: 'set isDeleted = :deleted, deletedAt = :deletedAt',
      ExpressionAttributeValues: {
        ':deleted': true,
        ':deletedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    await dynamoDB.update(params).promise();

    console.log('✅ DynamoWorkspaceMessage: Message soft deleted successfully');

    return { success: true };
  } catch (error) {
    console.error('❌ DynamoWorkspaceMessage: Error deleting message:', error);
    throw error;
  }
};

// Get message by ID (with decryption)
export const getMessageById = async (messageId) => {
  const params = {
    TableName: WORKSPACE_MESSAGES_TABLE,
    Key: {
      messageId: messageId
    }
  };

  try {
    const result = await dynamoDB.get(params).promise();
    
    if (!result.Item) {
      return null;
    }

    // Decrypt content if encrypted
    let finalContent = result.Item.content;
    if (result.Item.isEncrypted) {
      try {
        finalContent = await decryptMessage(result.Item.content);
      } catch (decryptError) {
        console.error('❌ Error decrypting message by ID:', decryptError);
        finalContent = '[Message could not be decrypted]';
      }
    }

    return {
      ...result.Item,
      content: finalContent,
      _id: result.Item.messageId
    };
  } catch (error) {
    console.error('❌ DynamoWorkspaceMessage: Error getting message by ID:', error);
    throw error;
  }
};

// Add reaction to message
export const addReaction = async (messageId, userId, reaction) => {
  try {
    console.log(`💬 DynamoWorkspaceMessage: Adding reaction to message ${messageId}...`);

    const params = {
      TableName: WORKSPACE_MESSAGES_TABLE,
      Key: {
        messageId: messageId
      },
      UpdateExpression: 'set reactions.#userId = :reaction',
      ExpressionAttributeNames: {
        '#userId': userId
      },
      ExpressionAttributeValues: {
        ':reaction': reaction
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    console.log('✅ DynamoWorkspaceMessage: Reaction added successfully');

    return {
      ...result.Attributes,
      _id: result.Attributes.messageId
    };
  } catch (error) {
    console.error('❌ DynamoWorkspaceMessage: Error adding reaction:', error);
    throw error;
  }
};

export { WORKSPACE_MESSAGES_TABLE };
