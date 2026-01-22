import { dynamoDB, COPILOT_KNOWLEDGE_TABLE, COPILOT_CONVERSATIONS_TABLE } from '../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Get all available categories and questions for the copilot knowledge base
 */
export const getKnowledgeBase = async (req, res) => {
  try {
    const params = {
      TableName: COPILOT_KNOWLEDGE_TABLE,
    };

    const result = await dynamoDB.scan(params).promise();
    
    // Group by category
    const categorized = {};
    result.Items?.forEach(item => {
      if (!categorized[item.category]) {
        categorized[item.category] = [];
      }
      categorized[item.category].push({
        id: item.id,
        question: item.question,
        answer: item.answer,
        keywords: item.keywords || [],
        followUpQuestions: item.followUpQuestions || [],
      });
    });

    res.json({
      success: true,
      data: categorized,
      totalItems: result.Items?.length || 0
    });
  } catch (error) {
    console.error('Error fetching knowledge base:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch knowledge base',
      error: error.message
    });
  }
};

/**
 * Search for answers based on user query
 */
export const searchAnswers = async (req, res) => {
  try {
    const { query, limit = 5, userId, workspaceId } = req.body;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Query is required'
      });
    }

    // Fetch all knowledge base items
    const params = {
      TableName: COPILOT_KNOWLEDGE_TABLE,
    };

    const result = await dynamoDB.scan(params).promise();
    
    if (!result.Items || result.Items.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'No answers found'
      });
    }

    // Simple keyword-based matching
    const queryLower = query.toLowerCase().split(/\s+/);
    
    const scoredResults = result.Items.map(item => {
      let score = 0;
      const questionLower = item.question.toLowerCase();
      const answerLower = item.answer.toLowerCase();
      const keywordsLower = (item.keywords || []).map(k => k.toLowerCase());

      // Check keywords
      queryLower.forEach(word => {
        keywordsLower.forEach(keyword => {
          if (keyword.includes(word) || word.includes(keyword)) {
            score += 3;
          }
        });
        
        // Check question
        if (questionLower.includes(word)) {
          score += 2;
        }
        
        // Check answer
        if (answerLower.includes(word)) {
          score += 1;
        }
      });

      return {
        id: item.id,
        question: item.question,
        answer: item.answer,
        category: item.category,
        followUpQuestions: item.followUpQuestions || [],
        score
      };
    });

    // Sort by score and return top results
    const topResults = scoredResults
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Store the query in conversation history
    if (userId && workspaceId) {
      const conversationId = `${workspaceId}#${userId}`;
      const messageId = uuidv4();
      
      const messageParams = {
        TableName: COPILOT_CONVERSATIONS_TABLE,
        Item: {
          conversationId,
          messageId,
          type: 'user',
          content: query,
          timestamp: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
        }
      };

      await dynamoDB.put(messageParams).promise().catch(err => {
        console.error('Error storing message:', err);
      });
    }

    res.json({
      success: true,
      data: topResults,
      totalResults: topResults.length
    });
  } catch (error) {
    console.error('Error searching answers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search answers',
      error: error.message
    });
  }
};

/**
 * Get conversation history for a workspace/user
 */
export const getConversationHistory = async (req, res) => {
  try {
    const { userId, workspaceId } = req.query;

    if (!userId || !workspaceId) {
      return res.status(400).json({
        success: false,
        message: 'userId and workspaceId are required'
      });
    }

    const conversationId = `${workspaceId}#${userId}`;

    const params = {
      TableName: COPILOT_CONVERSATIONS_TABLE,
      KeyConditionExpression: 'conversationId = :conversationId',
      ExpressionAttributeValues: {
        ':conversationId': conversationId
      },
      ScanIndexForward: true // Sort by timestamp ascending
    };

    const result = await dynamoDB.query(params).promise();

    res.json({
      success: true,
      data: result.Items || [],
      conversationId
    });
  } catch (error) {
    console.error('Error fetching conversation history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversation history',
      error: error.message
    });
  }
};

/**
 * Store an answer/response message in conversation
 */
export const storeMessage = async (req, res) => {
  try {
    const { userId, workspaceId, type, content, relatedAnswerId } = req.body;

    if (!userId || !workspaceId || !type || !content) {
      return res.status(400).json({
        success: false,
        message: 'userId, workspaceId, type, and content are required'
      });
    }

    const conversationId = `${workspaceId}#${userId}`;
    const messageId = uuidv4();

    const params = {
      TableName: COPILOT_CONVERSATIONS_TABLE,
      Item: {
        conversationId,
        messageId,
        type,
        content,
        relatedAnswerId: relatedAnswerId || null,
        timestamp: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
      }
    };

    await dynamoDB.put(params).promise();

    res.json({
      success: true,
      data: {
        messageId,
        conversationId,
        timestamp: params.Item.timestamp
      }
    });
  } catch (error) {
    console.error('Error storing message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to store message',
      error: error.message
    });
  }
};

/**
 * Submit feedback (like/dislike) on an answer
 */
export const submitFeedback = async (req, res) => {
  try {
    const { userId, workspaceId, answerId, feedback } = req.body;

    if (!userId || !workspaceId || !answerId || !['like', 'dislike'].includes(feedback)) {
      return res.status(400).json({
        success: false,
        message: 'userId, workspaceId, answerId, and feedback (like/dislike) are required'
      });
    }

    const feedbackId = uuidv4();
    const params = {
      TableName: 'copilot_feedback',
      Item: {
        feedbackId,
        userId,
        workspaceId,
        answerId,
        feedback,
        timestamp: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60) // 90 days
      }
    };

    await dynamoDB.put(params).promise();

    res.json({
      success: true,
      message: 'Feedback submitted successfully',
      data: { feedbackId }
    });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit feedback',
      error: error.message
    });
  }
};

/**
 * Get suggested follow-up questions
 */
export const getSuggestedQuestions = async (req, res) => {
  try {
    const { answerId, limit = 3 } = req.query;

    const params = {
      TableName: COPILOT_KNOWLEDGE_TABLE,
      Key: { id: answerId }
    };

    const result = await dynamoDB.get(params).promise();

    if (!result.Item) {
      return res.status(404).json({
        success: false,
        message: 'Answer not found'
      });
    }

    const followUpQuestions = result.Item.followUpQuestions || [];

    res.json({
      success: true,
      data: followUpQuestions.slice(0, limit)
    });
  } catch (error) {
    console.error('Error getting suggested questions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get suggested questions',
      error: error.message
    });
  }
};

/**
 * Get quick action suggestions based on current tab/context
 */
export const getQuickActions = async (req, res) => {
  try {
    const { currentTab } = req.query;

    const quickActionsMap = {
      tasks: [
        {
          action: 'Create your first task',
          description: 'Get started by creating a new task in the workspace',
          hint: 'Click the + button in Tasks panel'
        },
        {
          action: 'Learn about task status',
          description: 'Understand different task states',
          hint: 'See status icons in task list'
        }
      ],
      elements: [
        {
          action: 'Add your first element',
          description: 'Start designing your workspace',
          hint: 'Click Elements from the left sidebar'
        },
        {
          action: 'Explore element types',
          description: 'See what element types are available',
          hint: 'Browse Elements panel'
        }
      ],
      layouts: [
        {
          action: 'Use a layout template',
          description: 'Start with a predefined layout',
          hint: 'Select from Layouts panel'
        }
      ],
      messages: [
        {
          action: 'Start collaborating',
          description: 'Send your first message to team members',
          hint: 'Type in the Messages panel'
        }
      ]
    };

    const actions = quickActionsMap[currentTab] || quickActionsMap.tasks;

    res.json({
      success: true,
      data: actions
    });
  } catch (error) {
    console.error('Error getting quick actions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get quick actions',
      error: error.message
    });
  }
};

/**
 * Clear conversation history
 */
export const clearHistory = async (req, res) => {
  try {
    const { userId, workspaceId } = req.body;

    if (!userId || !workspaceId) {
      return res.status(400).json({
        success: false,
        message: 'userId and workspaceId are required'
      });
    }

    const conversationId = `${workspaceId}#${userId}`;

    // Query all messages for this conversation
    const queryParams = {
      TableName: COPILOT_CONVERSATIONS_TABLE,
      KeyConditionExpression: 'conversationId = :conversationId',
      ExpressionAttributeValues: {
        ':conversationId': conversationId
      }
    };

    const messages = await dynamoDB.query(queryParams).promise();

    // Delete each message
    for (const message of messages.Items || []) {
      const deleteParams = {
        TableName: COPILOT_CONVERSATIONS_TABLE,
        Key: {
          conversationId: message.conversationId,
          messageId: message.messageId
        }
      };
      await dynamoDB.delete(deleteParams).promise();
    }

    res.json({
      success: true,
      message: 'Conversation history cleared'
    });
  } catch (error) {
    console.error('Error clearing history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear history',
      error: error.message
    });
  }
};
