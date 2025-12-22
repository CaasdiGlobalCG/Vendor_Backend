import express from 'express';
import * as vendorLeadController from '../controllers/vendorLeadController.js';

const router = express.Router();

// Note: Vendor authentication middleware would be added here
// For now, vendorId is passed in request body for testing

// Vendor Lead Management Routes
router.post('/', vendorLeadController.getVendorLeads);                       // POST /api/vendor-leads (vendorId in body)
router.post('/stats', vendorLeadController.getVendorLeadStats);             // POST /api/vendor-leads/stats (vendorId in body)
router.get('/:leadId', vendorLeadController.getVendorLead);                 // GET /api/vendor-leads/:leadId
router.post('/:leadId/respond', vendorLeadController.respondToLead);        // POST /api/vendor-leads/:leadId/respond
router.put('/:leadId/response', vendorLeadController.updateLeadResponse);   // PUT /api/vendor-leads/:leadId/response
router.post('/:leadId/boq-download', vendorLeadController.getVendorLeadBoqUrl);   // POST /api/vendor-leads/:leadId/boq-download
router.post('/:leadId/quotation', vendorLeadController.uploadLeadQuotation);      // POST /api/vendor-leads/:leadId/quotation
router.put('/:leadId/quotation', vendorLeadController.updateLeadQuotation);       // PUT /api/vendor-leads/:leadId/quotation

export default router;
