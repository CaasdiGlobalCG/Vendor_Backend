import express from 'express';
import { authenticateUser } from '../../../middleware/authMiddleware.js';
import {
  getB2BDebitNotes,
  acknowledgeDebitNote,
  issueB2BCreditNote,
  getB2BCreditNotes,
} from '../controllers/b2bVendorController.js';

const router = express.Router();

// All routes require authentication (vendor)
router.use(authenticateUser);

// Debit Notes (sent from logistics to vendor)
router.get('/debit-notes',                         getB2BDebitNotes);
router.patch('/debit-notes/:debitNoteId/acknowledge', acknowledgeDebitNote);

// Credit Notes (vendor issues these in response to debit notes)
router.post('/credit-notes',  issueB2BCreditNote);
router.get('/credit-notes',   getB2BCreditNotes);

export default router;
