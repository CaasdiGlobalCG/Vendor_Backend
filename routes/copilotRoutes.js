import express from 'express';
import {
  getKnowledgeBase,
  searchAnswers,
  getConversationHistory,
  storeMessage,
  submitFeedback,
  getSuggestedQuestions,
  getQuickActions,
  clearHistory
} from '../controllers/copilotController.js';

const router = express.Router();

/**
 * @route GET /api/copilot/knowledge-base
 * @desc Get entire knowledge base with all categories and questions
 */
router.get('/knowledge-base', getKnowledgeBase);

/**
 * @route POST /api/copilot/search
 * @desc Search for answers based on user query
 * @body {string} query - User's question
 * @body {number} limit - Number of results to return (default 5)
 * @body {string} userId - User ID (optional, for history)
 * @body {string} workspaceId - Workspace ID (optional, for history)
 */
router.post('/search', searchAnswers);

/**
 * @route GET /api/copilot/history
 * @desc Get conversation history for a workspace/user
 */
router.get('/history', getConversationHistory);

/**
 * @route POST /api/copilot/message
 * @desc Store a message in conversation history
 */
router.post('/message', storeMessage);

/**
 * @route POST /api/copilot/feedback
 * @desc Submit feedback (like/dislike) on an answer
 */
router.post('/feedback', submitFeedback);

/**
 * @route GET /api/copilot/suggested-questions
 * @desc Get suggested follow-up questions for an answer
 */
router.get('/suggested-questions', getSuggestedQuestions);

/**
 * @route GET /api/copilot/quick-actions
 * @desc Get quick action suggestions based on current context
 */
router.get('/quick-actions', getQuickActions);

/**
 * @route POST /api/copilot/clear-history
 * @desc Clear conversation history
 */
router.post('/clear-history', clearHistory);

export default router;
