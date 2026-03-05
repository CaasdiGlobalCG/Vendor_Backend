import express from 'express';
import * as vendorLeadController from '../controllers/vendorLeadController.js';
import { authenticateCognitoJwt } from '../../../middleware/cognitoJwtMiddleware.js';
import { attachVendorId } from '../../../middleware/attachVendorId.js';
import { attachRBAC } from '../../rbac/middleware/attachRBAC.js';
import { requirePermission } from '../../rbac/middleware/requirePermission.js';

const router = express.Router();

// Auth → VendorId → RBAC for all vendor lead routes
router.use(authenticateCognitoJwt, attachVendorId, attachRBAC);

// Note: Vendor authentication middleware would be added here
// For now, vendorId is passed in request body for testing

// Vendor Lead Management Routes
router.post('/', requirePermission('leads', 'view'), vendorLeadController.getVendorLeads);                       // POST /api/vendor-leads (vendorId in body)
router.post('/stats', requirePermission('leads', 'view'), vendorLeadController.getVendorLeadStats);             // POST /api/vendor-leads/stats (vendorId in body)
router.get('/:leadId', requirePermission('leads', 'view'), vendorLeadController.getVendorLead);                 // GET /api/vendor-leads/:leadId
router.post('/:leadId/respond', requirePermission('leads', 'edit'), vendorLeadController.respondToLead);        // POST /api/vendor-leads/:leadId/respond
router.put('/:leadId/response', requirePermission('leads', 'edit'), vendorLeadController.updateLeadResponse);   // PUT /api/vendor-leads/:leadId/response
router.post('/:leadId/boq-download', requirePermission('leads', 'view'), vendorLeadController.getVendorLeadBoqUrl);   // POST /api/vendor-leads/:leadId/boq-download
router.post('/:leadId/quotation', requirePermission('leads', 'edit'), vendorLeadController.uploadLeadQuotation);      // POST /api/vendor-leads/:leadId/quotation
router.put('/:leadId/quotation', requirePermission('leads', 'edit'), vendorLeadController.updateLeadQuotation);       // PUT /api/vendor-leads/:leadId/quotation
router.post('/:leadId/vendor-boq', requirePermission('leads', 'edit'), vendorLeadController.uploadVendorBoq);         // POST /api/vendor-leads/:leadId/vendor-boq (vendor uploads their own BOQ)
router.post('/:leadId/vendor-quotation', requirePermission('leads', 'edit'), vendorLeadController.uploadVendorQuotation); // POST /api/vendor-leads/:leadId/vendor-quotation (quotation for vendor's BOQ)

export default router;
