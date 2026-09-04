import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';

// Configure AWS Chime SDK Meetings
const chimeSdkMeetings = new AWS.ChimeSDKMeetings({
  region: 'ap-south-1',
  
});

/**
 * Create a new Chime meeting for video call
 * @param {Object} meetingData - Meeting configuration
 * @param {string} meetingData.workspaceId - Workspace ID
 * @param {string} meetingData.callTitle - Title of the call
 * @param {string} meetingData.initiatorId - User ID who started the call
 * @param {string} meetingData.initiatorName - Name of the initiator
 * @returns {Promise<Object>} Meeting information with credentials
 */
export const createChimeMeeting = async (meetingData) => {
  try {
    const { workspaceId, callTitle, initiatorId, initiatorName } = meetingData;

    if (!workspaceId || !callTitle || !initiatorId || !initiatorName) {
      throw new Error('Missing required fields: workspaceId, callTitle, initiatorId, initiatorName');
    }

    const meetingId = uuidv4();
    const timestamp = Date.now().toString();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const externalMeetingId = `call-${timestamp}-${randomSuffix}`;

    console.log('🎥 Creating Chime meeting:', {
      meetingId,
      externalMeetingId,
      workspaceId,
      callTitle,
      initiatorId
    });

    const meetingParams = {
      ClientRequestToken: meetingId,
      ExternalMeetingId: externalMeetingId,
      MediaRegion: 'ap-south-1',
      MeetingHostId: initiatorId
    };

    const meetingResponse = await chimeSdkMeetings.createMeeting(meetingParams).promise();

    const meetingInfo = {
      meetingId: meetingResponse.Meeting.MeetingId,
      externalMeetingId: meetingResponse.Meeting.ExternalMeetingId,
      mediaRegion: meetingResponse.Meeting.MediaRegion,
      mediaPlacement: meetingResponse.Meeting.MediaPlacement,
      workspaceId,
      callTitle,
      initiatorId,
      initiatorName,
      createdAt: new Date().toISOString(),
      status: 'active',
      participants: []
    };

    console.log('✅ Chime meeting created successfully:', meetingInfo.meetingId);
    return meetingInfo;

  } catch (error) {
    console.error('❌ Error creating Chime meeting:', error);
    throw error;
  }
};

/**
 * Create attendee credentials for joining a meeting
 * @param {Object} attendeeData - Attendee configuration
 * @param {string} attendeeData.meetingId - Chime Meeting ID
 * @param {string} attendeeData.userId - User ID of attendee
 * @param {string} attendeeData.userName - Name of attendee
 * @returns {Promise<Object>} Attendee credentials
 */
export const createAttendeeCredentials = async (attendeeData) => {
  try {
    const { meetingId, userId, userName } = attendeeData;

    if (!meetingId || !userId || !userName) {
      throw new Error('Missing required fields: meetingId, userId, userName');
    }

    console.log('👤 Creating attendee credentials:', {
      meetingId,
      userId,
      userName
    });

    const attendeeParams = {
      MeetingId: meetingId,
      ExternalUserId: userId
    };

    const attendeeResponse = await chimeSdkMeetings.createAttendee(attendeeParams).promise();

    const attendeeInfo = {
      attendeeId: attendeeResponse.Attendee.AttendeeId,
      externalUserId: attendeeResponse.Attendee.ExternalUserId,
      joinToken: attendeeResponse.Attendee.JoinToken,
      userId,
      userName,
      joinedAt: new Date().toISOString()
    };

    console.log('✅ Attendee credentials created:', attendeeInfo.attendeeId);
    return attendeeInfo;

  } catch (error) {
    console.error('❌ Error creating attendee credentials:', error);
    throw error;
  }
};

/**
 * Get meeting information
 * @param {string} meetingId - Chime Meeting ID
 * @returns {Promise<Object>} Meeting details
 */
export const getMeetingInfo = async (meetingId) => {
  try {
    if (!meetingId) {
      throw new Error('Meeting ID is required');
    }

    console.log('🔍 Fetching meeting info:', meetingId);

    const params = {
      MeetingId: meetingId
    };

    const response = await chimeSdkMeetings.getMeeting(params).promise();

    console.log('✅ Meeting info retrieved:', meetingId);
    return response.Meeting;

  } catch (error) {
    console.error('❌ Error getting meeting info:', error);
    throw error;
  }
};

/**
 * List all attendees in a meeting
 * @param {string} meetingId - Chime Meeting ID
 * @returns {Promise<Array>} List of attendees
 */
export const listMeetingAttendees = async (meetingId) => {
  try {
    if (!meetingId) {
      throw new Error('Meeting ID is required');
    }

    console.log('👥 Fetching attendees for meeting:', meetingId);

    const params = {
      MeetingId: meetingId,
      MaxResults: 100
    };

    const response = await chimeSdkMeetings.listAttendees(params).promise();

    console.log('✅ Attendees retrieved:', response.Attendees.length);
    return response.Attendees;

  } catch (error) {
    console.error('❌ Error listing attendees:', error);
    throw error;
  }
};

/**
 * Delete a meeting (end the call)
 * @param {string} meetingId - Chime Meeting ID
 * @returns {Promise<void>}
 */
export const endChimeMeeting = async (meetingId) => {
  try {
    if (!meetingId) {
      throw new Error('Meeting ID is required');
    }

    console.log('🛑 Ending meeting:', meetingId);

    const params = {
      MeetingId: meetingId
    };

    await chimeSdkMeetings.deleteMeeting(params).promise();

    console.log('✅ Meeting ended successfully:', meetingId);

  } catch (error) {
    console.error('❌ Error ending meeting:', error);
    throw error;
  }
};

/**
 * Remove an attendee from a meeting
 * @param {string} meetingId - Chime Meeting ID
 * @param {string} attendeeId - Attendee ID to remove
 * @returns {Promise<void>}
 */
export const removeAttendee = async (meetingId, attendeeId) => {
  try {
    if (!meetingId || !attendeeId) {
      throw new Error('Meeting ID and Attendee ID are required');
    }

    console.log('❌ Removing attendee:', {
      meetingId,
      attendeeId
    });

    const params = {
      MeetingId: meetingId,
      AttendeeId: attendeeId
    };

    await chimeSdkMeetings.deleteAttendee(params).promise();

    console.log('✅ Attendee removed successfully:', attendeeId);

  } catch (error) {
    console.error('❌ Error removing attendee:', error);
    throw error;
  }
};
