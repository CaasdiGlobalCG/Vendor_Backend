import express from 'express';
import { 
  createMeeting, 
  createAttendee, 
  endMeeting, 
  getMeeting, 
  listAttendees 
} from '../controllers/chimeController.js';

const router = express.Router();

// Create a new meeting
router.post('/meetings', createMeeting);

// Create an attendee for a meeting
router.post('/meetings/:meetingId/attendees', createAttendee);

// Get meeting information
router.get('/meetings/:meetingId', getMeeting);

// List attendees in a meeting
router.get('/meetings/:meetingId/attendees', listAttendees);

// End a meeting
router.delete('/meetings/:meetingId', endMeeting);

export default router;

