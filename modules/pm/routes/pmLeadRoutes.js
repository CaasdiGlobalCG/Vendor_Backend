import express from 'express';
import * as pmLeadController from '../controllers/pmLeadController.js';
import { verifyPMToken } from '../controllers/pmAuthController.js';

const router = express.Router();

// All routes require PM authentication
router.use(verifyPMToken);

// Vendor Directory (for PM to select vendors) - MUST come before :leadId routes
router.get('/vendor-directory', pmLeadController.getVendorDirectory);     // GET /api/pm-leads/vendor-directory

// PM Lead Management Routes
router.post('/send-leads', pmLeadController.sendLeadsToVendors);           // POST /api/pm-leads/send-leads
router.get('/', pmLeadController.getPMLeads);                             // GET /api/pm-leads
router.get('/project/:projectId', pmLeadController.getProjectLeads);      // GET /api/pm-leads/project/:projectId
router.put('/:leadId/decision', pmLeadController.pmDecisionOnLead);       // PUT /api/pm-leads/:leadId/decision

// Negotiation Flow Routes
router.put('/:leadId/reject-with-reason', pmLeadController.rejectLeadWithReason);  // PUT /api/pm-leads/:leadId/reject-with-reason


export default router;
