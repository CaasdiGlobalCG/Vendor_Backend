import { dynamoDB, POST_SERVICES_TABLE } from '../../../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

// Create a new post service entry
export const createPostService = async (postData) => {
  const postId = uuidv4();
  const now = new Date().toISOString();

  const params = {
    TableName: POST_SERVICES_TABLE,
    Item: {
      postId: postId,
      workspaceId: postData.workspaceId,
      senderId: postData.senderId,
      senderName: postData.senderName,
      senderEmail: postData.senderEmail,
      senderRole: postData.senderRole || 'vendor',
      content: postData.content,
      attachments: postData.attachments || [],
      mentions: postData.mentions || [],
      hashtags: postData.hashtags || [],
      status: postData.status || 'open',
      priority: postData.priority || 'medium',
      comments: postData.comments || [],
      replies: [], // Initialize empty replies array
      subtaskId: postData.subtaskId || null, // For subtask association
      taskId: postData.taskId || null, // For task association
      createdAt: now,
      updatedAt: now,
    },
  };

  try {
    await dynamoDB.put(params).promise();
    return params.Item;
  } catch (error) {
    console.error('Error creating post service in DynamoDB:', error);
    throw error;
  }
};

// Add a reply to an existing post
export const addReplyToPost = async (workspaceId, postId, replyData) => {
  const replyId = uuidv4();
  const now = new Date().toISOString();

  const reply = {
    replyId: replyId,
    senderId: replyData.senderId,
    senderName: replyData.senderName,
    senderEmail: replyData.senderEmail,
    senderRole: replyData.senderRole || 'vendor',
    content: replyData.content,
    attachments: replyData.attachments || [],
    mentions: replyData.mentions || [],
    hashtags: replyData.hashtags || [],
    createdAt: now,
    updatedAt: now,
  };

  try {
    // Use scan to find the post by postId (more efficient than full query)
    const scanParams = {
      TableName: POST_SERVICES_TABLE,
      FilterExpression: 'workspaceId = :workspaceId AND postId = :postId',
      ExpressionAttributeValues: {
        ':workspaceId': workspaceId,
        ':postId': postId
      }
    };

    const scanResult = await dynamoDB.scan(scanParams).promise();
    
    if (!scanResult.Items || scanResult.Items.length === 0) {
      throw new Error(`Post with ID ${postId} not found in workspace ${workspaceId}`);
    }

    const targetPost = scanResult.Items[0];

    // Now update the post using the correct key structure
    const params = {
      TableName: POST_SERVICES_TABLE,
      Key: {
        workspaceId: workspaceId,
        createdAt: targetPost.createdAt
      },
      UpdateExpression: 'SET replies = list_append(if_not_exists(replies, :empty_list), :reply), updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':reply': [reply],
        ':empty_list': [],
        ':updatedAt': now
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();
    return result.Attributes;
  } catch (error) {
    console.error('Error adding reply to post in DynamoDB:', error);
    throw error;
  }
};

// Get post services by subtask ID
export const getPostServicesBySubtask = async (workspaceId, subtaskId, limit = 50, lastEvaluatedKey = null) => {
  const params = {
    TableName: POST_SERVICES_TABLE,
    KeyConditionExpression: 'workspaceId = :workspaceId',
    FilterExpression: 'subtaskId = :subtaskId',
    ExpressionAttributeValues: {
      ':workspaceId': workspaceId,
      ':subtaskId': subtaskId,
    },
    Limit: limit,
    ScanIndexForward: false, // Most recent first
  };

  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }

  try {
    const result = await dynamoDB.query(params).promise();
    const allItems = result.Items || [];
    
    // Filter out any items that have parentPostId (these are old separate reply documents)
    const posts = allItems.filter(item => !item.parentPostId);
    
    // Sort replies within each post by creation date (oldest first)
    const postsWithReplies = posts.map(post => ({
      ...post,
      replies: (post.replies || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    }));
    
    return {
      posts: postsWithReplies,
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  } catch (error) {
    console.error('Error getting post services by subtask ID from DynamoDB:', error);
    throw error;
  }
};

// Get post services by workspace ID
export const getPostServicesByWorkspace = async (workspaceId, limit = 50, lastEvaluatedKey = null) => {
  const params = {
    TableName: POST_SERVICES_TABLE,
    KeyConditionExpression: 'workspaceId = :workspaceId',
    ExpressionAttributeValues: {
      ':workspaceId': workspaceId,
    },
    Limit: limit,
    ScanIndexForward: false, // Most recent first
  };

  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }

  try {
    const result = await dynamoDB.query(params).promise();
    const allItems = result.Items || [];
    
    // Filter out any items that have parentPostId (these are old separate reply documents)
    const posts = allItems.filter(item => !item.parentPostId);
    
    // Sort replies within each post by creation date (oldest first)
    const postsWithReplies = posts.map(post => ({
      ...post,
      replies: (post.replies || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    }));
    
    return {
      posts: postsWithReplies,
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  } catch (error) {
    console.error('Error getting post services by workspace ID from DynamoDB:', error);
    throw error;
  }
};

// Update a post service entry
export const updatePostService = async (postId, workspaceId, updateData) => {
  const now = new Date().toISOString();
  let updateExpression = 'set updatedAt = :updatedAt';
  const expressionAttributeValues = {
    ':updatedAt': now,
  };
  const expressionAttributeNames = {};

  Object.keys(updateData).forEach((key, index) => {
    if (key === 'postId' || key === 'workspaceId' || key === 'createdAt') return; // Primary keys cannot be updated

    const attributeValueKey = `:val${index}`;
    const attributeNameKey = `#attr${key}`;

    updateExpression += `, ${attributeNameKey} = ${attributeValueKey}`;
    expressionAttributeValues[attributeValueKey] = updateData[key];
    expressionAttributeNames[attributeNameKey] = key;
  });

  const params = {
    TableName: POST_SERVICES_TABLE,
    Key: {
      workspaceId: workspaceId,
      postId: postId,
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ExpressionAttributeNames: expressionAttributeNames,
    ReturnValues: 'ALL_NEW',
  };

  try {
    const result = await dynamoDB.update(params).promise();
    return result.Attributes;
  } catch (error) {
    console.error('Error updating post service in DynamoDB:', error);
    throw error;
  }
};

// Delete a post service entry
export const deletePostService = async (postId, workspaceId) => {
  const params = {
    TableName: POST_SERVICES_TABLE,
    Key: {
      workspaceId: workspaceId,
      postId: postId,
    },
  };

  try {
    await dynamoDB.delete(params).promise();
    return { success: true };
  } catch (error) {
    console.error('Error deleting post service from DynamoDB:', error);
    throw error;
  }
};

// Get a single post service entry by ID
export const getPostServiceById = async (postId, workspaceId) => {
  const params = {
    TableName: POST_SERVICES_TABLE,
    Key: {
      workspaceId: workspaceId,
      postId: postId,
    },
  };

  try {
    const result = await dynamoDB.get(params).promise();
    return result.Item || null;
  } catch (error) {
    console.error('Error getting post service by ID from DynamoDB:', error);
    throw error;
  }
};

