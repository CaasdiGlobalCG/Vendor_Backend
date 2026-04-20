import { Router } from 'express';
import {
  listWorkspaceQueryConversations,
  openWorkspaceQueryConversation,
  getWorkspaceQueryConversation,
  sendWorkspaceQueryMessage,
} from '../controllers/procurementQueriesController.js';

const router = Router();

router.get('/conversations', listWorkspaceQueryConversations);
router.post('/conversations/open', openWorkspaceQueryConversation);
router.get('/conversations/:conversationId', getWorkspaceQueryConversation);
router.post('/conversations/:conversationId/messages', sendWorkspaceQueryMessage);

export default router;
