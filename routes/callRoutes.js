import express from 'express';
import {
  startCall,
  joinCall,
  leaveCall,
  declineCall,
  getCallDetails,
  endCallController,
  listActiveCalls
} from '../controllers/callController.js';

const router = express.Router();

/**
 * Start a new video call
 * POST /api/calls/start
 * Body: { workspaceId, callTitle, initiatorId, initiatorName, invitedUserIds }
 */
router.post('/start', startCall);

/**
 * Join an existing call
 * POST /api/calls/join
 * Body: { meetingId, userId, userName }
 */
router.post('/join', joinCall);

/**
 * Leave a call
 * POST /api/calls/leave
 * Body: { meetingId, userId, userName }
 */
router.post('/leave', leaveCall);

/**
 * Decline a call invitation
 * POST /api/calls/decline
 * Body: { meetingId, userId, userName }
 */
router.post('/decline', declineCall);

/**
 * End a call
 * POST /api/calls/end
 * Body: { meetingId }
 */
router.post('/end', endCallController);

/**
 * Get call details
 * GET /api/calls/:meetingId
 */
router.get('/:meetingId', getCallDetails);

/**
 * List all active calls
 * GET /api/calls
 */
router.get('/', listActiveCalls);

export default router;
