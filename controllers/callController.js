import * as chimeCallService from '../services/chimeCallService.js';
import * as callNotificationService from '../services/callNotificationService.js';
import { v4 as uuidv4 } from 'uuid';

// Store active calls in memory (in production, use DynamoDB)
const activeCalls = new Map();

/**
 * Start a new video call
 * POST /api/calls/start
 * Body: { workspaceId, callTitle, initiatorId, initiatorName, invitedUserIds }
 */
export const startCall = async (req, res) => {
  try {
    const { workspaceId, callTitle, initiatorId, initiatorName, invitedUserIds } = req.body;

    if (!workspaceId || !callTitle || !initiatorId || !initiatorName || !invitedUserIds) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: workspaceId, callTitle, initiatorId, initiatorName, invitedUserIds'
      });
    }

    console.log('🎥 Starting video call:', {
      workspaceId,
      callTitle,
      initiatorId,
      invitedUsersCount: invitedUserIds.length
    });

    // Create Chime meeting
    const meetingInfo = await chimeCallService.createChimeMeeting({
      workspaceId,
      callTitle,
      initiatorId,
      initiatorName
    });

    // Add initiator as first participant
    const initiatorAttendee = await chimeCallService.createAttendeeCredentials({
      meetingId: meetingInfo.meetingId,
      userId: initiatorId,
      userName: initiatorName
    });

    meetingInfo.participants = [
      {
        userId: initiatorId,
        userName: initiatorName,
        attendeeId: initiatorAttendee.attendeeId,
        joinToken: initiatorAttendee.joinToken,
        joinedAt: new Date().toISOString(),
        status: 'joined'
      }
    ];

    // Store call info
    activeCalls.set(meetingInfo.meetingId, {
      ...meetingInfo,
      invitedUserIds,
      declinedUserIds: [],
      createdAt: new Date().toISOString()
    });

    // Send invitations to other users
    callNotificationService.sendCallInvitations(invitedUserIds, meetingInfo);

    console.log('✅ Call started successfully:', meetingInfo.meetingId);

    res.status(201).json({
      success: true,
      message: 'Call started successfully',
      call: {
        meetingId: meetingInfo.meetingId,
        externalMeetingId: meetingInfo.externalMeetingId,
        workspaceId,
        callTitle,
        initiatorId,
        initiatorName,
        mediaPlacement: meetingInfo.mediaPlacement,
        participants: meetingInfo.participants,
        createdAt: new Date().toISOString(),
        // Include attendee info as nested object for Chime SDK
        attendee: {
          attendeeId: initiatorAttendee.attendeeId,
          joinToken: initiatorAttendee.joinToken,
          externalUserId: initiatorId
        }
      }
    });

  } catch (error) {
    console.error('❌ Error starting call:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start call',
      error: error.message
    });
  }
};

/**
 * Join an existing call
 * POST /api/calls/join
 * Body: { meetingId, userId, userName }
 */
export const joinCall = async (req, res) => {
  try {
    const { meetingId, userId, userName } = req.body;

    if (!meetingId || !userId || !userName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: meetingId, userId, userName'
      });
    }

    console.log('👤 User joining call:', {
      meetingId,
      userId,
      userName
    });

    // Get call info
    const callInfo = activeCalls.get(meetingId);
    if (!callInfo) {
      return res.status(404).json({
        success: false,
        message: 'Call not found'
      });
    }

    // Create attendee credentials
    const attendeeInfo = await chimeCallService.createAttendeeCredentials({
      meetingId,
      userId,
      userName
    });

    // Add to participants
    const participant = {
      userId,
      userName,
      attendeeId: attendeeInfo.attendeeId,
      joinToken: attendeeInfo.joinToken,
      joinedAt: new Date().toISOString(),
      status: 'joined'
    };

    callInfo.participants.push(participant);

    // Notify other participants that this user joined
    const otherParticipantIds = callInfo.participants
      .filter(p => p.userId !== userId)
      .map(p => p.userId);

    callNotificationService.notifyParticipantJoined(
      otherParticipantIds,
      { userId, userName },
      {
        meetingId,
        workspaceId: callInfo.workspaceId,
        callTitle: callInfo.callTitle
      }
    );

    console.log('✅ User joined call successfully:', userId);

    res.status(200).json({
      success: true,
      message: 'Joined call successfully',
      attendee: {
        attendeeId: attendeeInfo.attendeeId,
        joinToken: attendeeInfo.joinToken,
        externalUserId: attendeeInfo.externalUserId
      },
      call: {
        meetingId,
        callTitle: callInfo.callTitle,
        initiatorId: callInfo.initiatorId,
        initiatorName: callInfo.initiatorName,
        createdAt: callInfo.createdAt,
        workspaceId: callInfo.workspaceId,
        mediaPlacement: callInfo.mediaPlacement,
        externalMeetingId: callInfo.externalMeetingId,
        // Include attendee info in call object for Chime SDK
        attendee: {
          attendeeId: attendeeInfo.attendeeId,
          joinToken: attendeeInfo.joinToken,
          externalUserId: attendeeInfo.externalUserId
        },
        participants: callInfo.participants.map(p => ({
          userId: p.userId,
          userName: p.userName,
          status: p.status
        }))
      }
    });

  } catch (error) {
    console.error('❌ Error joining call:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to join call',
      error: error.message
    });
  }
};

/**
 * Leave a call
 * POST /api/calls/leave
 * Body: { meetingId, userId, userName }
 */
export const leaveCall = async (req, res) => {
  try {
    const { meetingId, userId, userName } = req.body;

    if (!meetingId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: meetingId, userId'
      });
    }

    console.log('👋 User leaving call:', {
      meetingId,
      userId
    });

    const callInfo = activeCalls.get(meetingId);
    if (!callInfo) {
      return res.status(404).json({
        success: false,
        message: 'Call not found'
      });
    }

    // Find and remove participant
    const participantIndex = callInfo.participants.findIndex(p => p.userId === userId);
    if (participantIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Participant not found in call'
      });
    }

    const participant = callInfo.participants[participantIndex];
    callInfo.participants.splice(participantIndex, 1);

    // Remove attendee from Chime meeting
    try {
      await chimeCallService.removeAttendee(meetingId, participant.attendeeId);
    } catch (chimeError) {
      console.warn('Warning: Could not remove attendee from Chime:', chimeError.message);
    }

    // Notify other participants
    const remainingParticipantIds = callInfo.participants.map(p => p.userId);
    callNotificationService.notifyParticipantLeft(
      remainingParticipantIds,
      { userId, userName },
      {
        meetingId,
        workspaceId: callInfo.workspaceId,
        callTitle: callInfo.callTitle
      }
    );

    // If no more participants, end the call
    if (callInfo.participants.length === 0) {
      await endCall(meetingId);
    }

    console.log('✅ User left call successfully:', userId);

    res.status(200).json({
      success: true,
      message: 'Left call successfully',
      remainingParticipants: callInfo.participants.length
    });

  } catch (error) {
    console.error('❌ Error leaving call:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to leave call',
      error: error.message
    });
  }
};

/**
 * Decline a call invitation
 * POST /api/calls/decline
 * Body: { meetingId, userId, userName }
 */
export const declineCall = async (req, res) => {
  try {
    const { meetingId, userId, userName } = req.body;

    if (!meetingId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: meetingId, userId'
      });
    }

    console.log('❌ User declining call:', {
      meetingId,
      userId
    });

    const callInfo = activeCalls.get(meetingId);
    if (!callInfo) {
      return res.status(404).json({
        success: false,
        message: 'Call not found'
      });
    }

    // Add to declined users
    if (!callInfo.declinedUserIds.includes(userId)) {
      callInfo.declinedUserIds.push(userId);
    }

    // Notify initiator
    callNotificationService.notifyCallDeclined(
      callInfo.initiatorId,
      { userId, userName },
      {
        meetingId,
        workspaceId: callInfo.workspaceId,
        callTitle: callInfo.callTitle
      }
    );

    console.log('✅ Call declined:', userId);

    res.status(200).json({
      success: true,
      message: 'Call declined successfully'
    });

  } catch (error) {
    console.error('❌ Error declining call:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to decline call',
      error: error.message
    });
  }
};

/**
 * Get call details
 * GET /api/calls/:meetingId
 */
export const getCallDetails = async (req, res) => {
  try {
    const { meetingId } = req.params;

    if (!meetingId) {
      return res.status(400).json({
        success: false,
        message: 'Meeting ID is required'
      });
    }

    const callInfo = activeCalls.get(meetingId);
    if (!callInfo) {
      return res.status(404).json({
        success: false,
        message: 'Call not found'
      });
    }

    res.status(200).json({
      success: true,
      call: {
        meetingId: callInfo.meetingId,
        externalMeetingId: callInfo.externalMeetingId,
        workspaceId: callInfo.workspaceId,
        callTitle: callInfo.callTitle,
        initiatorId: callInfo.initiatorId,
        initiatorName: callInfo.initiatorName,
        status: callInfo.status,
        participants: callInfo.participants.map(p => ({
          userId: p.userId,
          userName: p.userName,
          status: p.status,
          joinedAt: p.joinedAt
        })),
        createdAt: callInfo.createdAt,
        declinedCount: callInfo.declinedUserIds.length
      }
    });

  } catch (error) {
    console.error('❌ Error getting call details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get call details',
      error: error.message
    });
  }
};

/**
 * End a call
 * POST /api/calls/end
 * Body: { meetingId }
 */
export const endCallController = async (req, res) => {
  try {
    const { meetingId } = req.body;

    if (!meetingId) {
      return res.status(400).json({
        success: false,
        message: 'Meeting ID is required'
      });
    }

    const callInfo = activeCalls.get(meetingId);
    if (!callInfo) {
      return res.status(404).json({
        success: false,
        message: 'Call not found'
      });
    }

    // Get participants before ending
    const participantIds = callInfo.participants.map(p => p.userId);

    // End the call
    await endCall(meetingId);

    // Notify all participants
    callNotificationService.notifyCallEnded(
      participantIds,
      {
        meetingId,
        workspaceId: callInfo.workspaceId,
        callTitle: callInfo.callTitle,
        initiatorName: callInfo.initiatorName
      }
    );

    console.log('✅ Call ended successfully:', meetingId);

    res.status(200).json({
      success: true,
      message: 'Call ended successfully'
    });

  } catch (error) {
    console.error('❌ Error ending call:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to end call',
      error: error.message
    });
  }
};

/**
 * Internal function to end a call
 */
async function endCall(meetingId) {
  try {
    const callInfo = activeCalls.get(meetingId);
    if (callInfo) {
      // End Chime meeting
      await chimeCallService.endChimeMeeting(meetingId);
      
      // Remove from active calls
      activeCalls.delete(meetingId);
      
      console.log('✅ Call cleanup completed:', meetingId);
    }
  } catch (error) {
    console.error('❌ Error in endCall:', error);
  }
}

/**
 * List all active calls
 * GET /api/calls
 */
export const listActiveCalls = async (req, res) => {
  try {
    const calls = Array.from(activeCalls.values()).map(call => ({
      meetingId: call.meetingId,
      callTitle: call.callTitle,
      initiatorName: call.initiatorName,
      workspaceId: call.workspaceId,
      participantCount: call.participants.length,
      createdAt: call.createdAt,
      status: call.status
    }));

    res.status(200).json({
      success: true,
      calls,
      totalActive: calls.length
    });

  } catch (error) {
    console.error('❌ Error listing calls:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list calls',
      error: error.message
    });
  }
};
