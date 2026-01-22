import { sendNotificationToUser } from '../websocket/notificationSocket.js';

/**
 * Send call invitation to multiple users
 * @param {Array<string>} recipientIds - User IDs to invite
 * @param {Object} callData - Call information
 */
export const sendCallInvitations = (recipientIds, callData) => {
  const {
    meetingId,
    externalMeetingId,
    workspaceId,
    callTitle,
    initiatorId,
    initiatorName,
    mediaPlacement
  } = callData;

  recipientIds.forEach(recipientId => {
    // Don't send invitation to the initiator
    if (recipientId === initiatorId) return;

    const notification = {
      id: `call-invite-${meetingId}-${recipientId}-${Date.now()}`,
      type: 'call_invitation',
      title: '📞 Incoming Call',
      message: `${initiatorName} is inviting you to a call: "${callTitle}"`,
      data: {
        meetingId,
        externalMeetingId,
        workspaceId,
        callTitle,
        initiatorId,
        initiatorName,
        mediaPlacement,
        callType: 'video'
      },
      timestamp: new Date().toISOString(),
      priority: 'high',
      actionRequired: true,
      actions: [
        {
          type: 'join_call',
          label: 'Join Call',
          url: `/workspace/${workspaceId}?call=${meetingId}`
        },
        {
          type: 'decline',
          label: 'Decline',
          url: null
        }
      ]
    };

    console.log(`📞 Sending call invitation to user ${recipientId}:`, callData.callTitle);
    sendNotificationToUser(recipientId, notification);
  });
};

/**
 * Send notification when someone joins the call
 * @param {Array<string>} participantIds - IDs of all call participants
 * @param {Object} joinedUser - User who just joined
 * @param {Object} callData - Call information
 */
export const notifyParticipantJoined = (participantIds, joinedUser, callData) => {
  const { meetingId, workspaceId, callTitle } = callData;
  const { userId, userName } = joinedUser;

  participantIds.forEach(participantId => {
    // Don't send to the user who just joined
    if (participantId === userId) return;

    const notification = {
      id: `call-joined-${meetingId}-${userId}-${Date.now()}`,
      type: 'call_participant_joined',
      title: '👤 Call Participant Joined',
      message: `${userName} joined the call "${callTitle}"`,
      data: {
        meetingId,
        workspaceId,
        callTitle,
        joinedUserId: userId,
        joinedUserName: userName,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString(),
      priority: 'low',
      actionRequired: false
    };

    console.log(`📞 Notifying ${participantId} that ${userName} joined the call`);
    sendNotificationToUser(participantId, notification);
  });
};

/**
 * Send notification when someone leaves the call
 * @param {Array<string>} participantIds - IDs of remaining participants
 * @param {Object} leftUser - User who left
 * @param {Object} callData - Call information
 */
export const notifyParticipantLeft = (participantIds, leftUser, callData) => {
  const { meetingId, workspaceId, callTitle } = callData;
  const { userId, userName } = leftUser;

  participantIds.forEach(participantId => {
    if (participantId === userId) return;

    const notification = {
      id: `call-left-${meetingId}-${userId}-${Date.now()}`,
      type: 'call_participant_left',
      title: '👋 Call Participant Left',
      message: `${userName} left the call "${callTitle}"`,
      data: {
        meetingId,
        workspaceId,
        callTitle,
        leftUserId: userId,
        leftUserName: userName,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString(),
      priority: 'low',
      actionRequired: false
    };

    console.log(`📞 Notifying ${participantId} that ${userName} left the call`);
    sendNotificationToUser(participantId, notification);
  });
};

/**
 * Send notification when call ends
 * @param {Array<string>} participantIds - IDs of call participants
 * @param {Object} callData - Call information
 */
export const notifyCallEnded = (participantIds, callData) => {
  const { meetingId, workspaceId, callTitle, initiatorName } = callData;

  participantIds.forEach(participantId => {
    const notification = {
      id: `call-ended-${meetingId}-${participantId}-${Date.now()}`,
      type: 'call_ended',
      title: '📞 Call Ended',
      message: `The call "${callTitle}" has ended`,
      data: {
        meetingId,
        workspaceId,
        callTitle,
        initiatorName,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString(),
      priority: 'low',
      actionRequired: false
    };

    console.log(`📞 Notifying ${participantId} that the call has ended`);
    sendNotificationToUser(participantId, notification);
  });
};

/**
 * Send notification when call is declined
 * @param {string} initiatorId - ID of call initiator
 * @param {Object} declinedUser - User who declined
 * @param {Object} callData - Call information
 */
export const notifyCallDeclined = (initiatorId, declinedUser, callData) => {
  const { meetingId, workspaceId, callTitle } = callData;
  const { userId, userName } = declinedUser;

  const notification = {
    id: `call-declined-${meetingId}-${userId}-${Date.now()}`,
    type: 'call_declined',
    title: '❌ Call Declined',
    message: `${userName} declined your call "${callTitle}"`,
    data: {
      meetingId,
      workspaceId,
      callTitle,
      declinedUserId: userId,
      declinedUserName: userName,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString(),
    priority: 'low',
    actionRequired: false
  };

  console.log(`📞 Notifying ${initiatorId} that ${userName} declined the call`);
  sendNotificationToUser(initiatorId, notification);
};

/**
 * Send notification when call is cancelled
 * @param {Array<string>} recipientIds - User IDs who were invited
 * @param {Object} callData - Call information
 */
export const notifyCallCancelled = (recipientIds, callData) => {
  const { meetingId, workspaceId, callTitle, initiatorName } = callData;

  recipientIds.forEach(recipientId => {
    const notification = {
      id: `call-cancelled-${meetingId}-${recipientId}-${Date.now()}`,
      type: 'call_cancelled',
      title: '❌ Call Cancelled',
      message: `The call "${callTitle}" initiated by ${initiatorName} has been cancelled`,
      data: {
        meetingId,
        workspaceId,
        callTitle,
        initiatorName,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString(),
      priority: 'low',
      actionRequired: false
    };

    console.log(`📞 Notifying ${recipientId} that the call has been cancelled`);
    sendNotificationToUser(recipientId, notification);
  });
};
