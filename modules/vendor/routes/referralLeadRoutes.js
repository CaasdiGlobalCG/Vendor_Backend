import express from 'express';
import * as referralLeadController from '../controllers/referralLeadController.js';

const router = express.Router();

// List referral leads for a vendor (sent leads history)
router.get('/', referralLeadController.listReferralLeadsByReferrer); // GET /api/referral-leads?referrerVendorId=...&limit=...&nextToken=...

// Create a new referral lead
router.post('/', referralLeadController.createReferralLead); // POST /api/referral-leads

export default router;
