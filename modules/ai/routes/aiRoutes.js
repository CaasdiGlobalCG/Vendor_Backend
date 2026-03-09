// ============================================================
// FILE: modules/ai/routes/aiRoutes.js
// PURPOSE: Express routes for the AI chat assistant module.
// ============================================================

import { Router } from 'express';
import { authenticateCognitoJwt } from '../../../middleware/cognitoJwtMiddleware.js';
import { attachVendorId } from '../../../middleware/attachVendorId.js';
import {
  handleChat,
  handleChatStream,
  handleListConversations,
  handleCreateConversation,
  handleGetConversation,
  handleDeleteConversation,
  handleFeedback,
  handleHealthCheck,
  handleLearningStats,
} from '../controllers/aiController.js';
import {
  handleCreateSchedule,
  handleCreateFromText,
  handleListSchedules,
  handleGetSchedule,
  handleUpdateSchedule,
  handleDeleteSchedule,
  handleToggleSchedule,
} from '../controllers/schedulerController.js';
import {
  handleMentionSearch,
  handleMentionTypes,
} from '../controllers/mentionController.js';
import {
  handleGetAlerts,
  handleDismissAlert,
} from '../controllers/proactiveAlertsController.js';

const router = Router();

// All AI routes require authentication + vendorId resolution
const authChain = [authenticateCognitoJwt, attachVendorId];

// Health check (no auth needed)
router.get('/health', handleHealthCheck);

// Chat endpoints
router.post('/chat', ...authChain, handleChat);
router.post('/chat/stream', ...authChain, handleChatStream);

// Feedback (reinforcement learning)
router.post('/feedback', ...authChain, handleFeedback);

// Learning stats
router.get('/learning-stats', ...authChain, handleLearningStats);

// Conversation management
router.get('/conversations', ...authChain, handleListConversations);
router.post('/conversations', ...authChain, handleCreateConversation);
router.get('/conversations/:id', ...authChain, handleGetConversation);
router.delete('/conversations/:id', ...authChain, handleDeleteConversation);

// Scheduled reports & reminders
router.get('/schedules', ...authChain, handleListSchedules);
router.post('/schedules', ...authChain, handleCreateSchedule);
router.post('/schedules/from-text', ...authChain, handleCreateFromText);
router.get('/schedules/:id', ...authChain, handleGetSchedule);
router.patch('/schedules/:id', ...authChain, handleUpdateSchedule);
router.delete('/schedules/:id', ...authChain, handleDeleteSchedule);
router.patch('/schedules/:id/toggle', ...authChain, handleToggleSchedule);

// @ Mention entity search
router.get('/mentions/search', ...authChain, handleMentionSearch);
router.get('/mentions/types', ...authChain, handleMentionTypes);

// Proactive alerts
router.get('/alerts', ...authChain, handleGetAlerts);
router.post('/alerts/dismiss', ...authChain, handleDismissAlert);

export default router;
