import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';

// Configure AWS Chime SDK Meetings (using the new endpoint)
const chimeSdkMeetings = new AWS.ChimeSDKMeetings({
  region: 'us-east-1', // Chime meetings are only available in us-east-1
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

// Create a new Chime meeting
export const createMeeting = async (req, res) => {
  try {
    const { workspaceId, meetingTitle, createdBy } = req.body;

    if (!workspaceId || !meetingTitle || !createdBy) {
      return res.status(400).json({ 
        error: 'Missing required fields: workspaceId, meetingTitle, createdBy' 
      });
    }

    const meetingId = uuidv4();
    // Keep external meeting ID under 64 characters - use timestamp + random string
    const timestamp = Date.now().toString();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const externalMeetingId = `ws-${timestamp}-${randomSuffix}`;

    console.log('🎥 ChimeController: Creating meeting:', {
      meetingId,
      externalMeetingId,
      workspaceId,
      meetingTitle,
      externalMeetingIdLength: externalMeetingId.length
    });

    // Create the meeting
    const meetingParams = {
      ClientRequestToken: meetingId,
      ExternalMeetingId: externalMeetingId,
      MediaRegion: 'us-east-1',
      MeetingHostId: createdBy
    };

    const meetingResponse = await chimeSdkMeetings.createMeeting(meetingParams).promise();

    console.log('✅ ChimeController: Meeting created successfully:', meetingResponse.Meeting.MeetingId);

    // Return meeting information
    res.status(201).json({
      success: true,
      meeting: {
        meetingId: meetingResponse.Meeting.MeetingId,
        externalMeetingId: meetingResponse.Meeting.ExternalMeetingId,
        mediaRegion: meetingResponse.Meeting.MediaRegion,
        mediaPlacement: meetingResponse.Meeting.MediaPlacement,
        workspaceId,
        meetingTitle,
        createdBy,
        createdAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ ChimeController: Error creating meeting:', error);
    res.status(500).json({ 
      error: 'Failed to create meeting',
      details: error.message 
    });
  }
};

// Create an attendee for a meeting
export const createAttendee = async (req, res) => {
  try {
    const { meetingId } = req.params; // Get meetingId from URL params
    const { userId, userName } = req.body;

    if (!meetingId || !userId || !userName) {
      return res.status(400).json({ 
        error: 'Missing required fields: meetingId, userId, userName' 
      });
    }

    console.log('👤 ChimeController: Creating attendee:', {
      meetingId,
      userId,
      userName
    });

    const attendeeParams = {
      MeetingId: meetingId,
      ExternalUserId: userId
    };

    const attendeeResponse = await chimeSdkMeetings.createAttendee(attendeeParams).promise();

    console.log('✅ ChimeController: Attendee created successfully:', attendeeResponse.Attendee.AttendeeId);

    res.status(201).json({
      success: true,
      attendee: {
        attendeeId: attendeeResponse.Attendee.AttendeeId,
        externalUserId: attendeeResponse.Attendee.ExternalUserId,
        joinToken: attendeeResponse.Attendee.JoinToken,
        userName,
        joinedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ ChimeController: Error creating attendee:', error);
    res.status(500).json({ 
      error: 'Failed to create attendee',
      details: error.message 
    });
  }
};

// End a meeting
export const endMeeting = async (req, res) => {
  try {
    const { meetingId } = req.params;

    if (!meetingId) {
      return res.status(400).json({ error: 'Meeting ID is required' });
    }

    console.log('🛑 ChimeController: Ending meeting:', meetingId);

    await chimeSdkMeetings.deleteMeeting({ MeetingId: meetingId }).promise();

    console.log('✅ ChimeController: Meeting ended successfully:', meetingId);

    res.status(200).json({
      success: true,
      message: 'Meeting ended successfully',
      meetingId,
      endedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ ChimeController: Error ending meeting:', error);
    res.status(500).json({ 
      error: 'Failed to end meeting',
      details: error.message 
    });
  }
};

// Get meeting information
export const getMeeting = async (req, res) => {
  try {
    const { meetingId } = req.params;

    if (!meetingId) {
      return res.status(400).json({ error: 'Meeting ID is required' });
    }

    console.log('📋 ChimeController: Getting meeting info:', meetingId);

    const meetingResponse = await chimeSdkMeetings.getMeeting({ MeetingId: meetingId }).promise();

    res.status(200).json({
      success: true,
      meeting: {
        meetingId: meetingResponse.Meeting.MeetingId,
        externalMeetingId: meetingResponse.Meeting.ExternalMeetingId,
        mediaRegion: meetingResponse.Meeting.MediaRegion,
        mediaPlacement: meetingResponse.Meeting.MediaPlacement
      }
    });

  } catch (error) {
    console.error('❌ ChimeController: Error getting meeting:', error);
    
    if (error.code === 'NotFoundException') {
      return res.status(404).json({ 
        error: 'Meeting not found',
        meetingId 
      });
    }

    res.status(500).json({ 
      error: 'Failed to get meeting information',
      details: error.message 
    });
  }
};

// List attendees in a meeting
export const listAttendees = async (req, res) => {
  try {
    const { meetingId } = req.params;

    if (!meetingId) {
      return res.status(400).json({ error: 'Meeting ID is required' });
    }

    console.log('👥 ChimeController: Listing attendees for meeting:', meetingId);

    const attendeesResponse = await chimeSdkMeetings.listAttendees({ MeetingId: meetingId }).promise();

    res.status(200).json({
      success: true,
      attendees: attendeesResponse.Attendees.map(attendee => ({
        attendeeId: attendee.AttendeeId,
        externalUserId: attendee.ExternalUserId,
        joinToken: attendee.JoinToken
      }))
    });

  } catch (error) {
    console.error('❌ ChimeController: Error listing attendees:', error);
    res.status(500).json({ 
      error: 'Failed to list attendees',
      details: error.message 
    });
  }
};
