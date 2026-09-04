// FILE: modules/vendor/routes/physicalKYCRoutes.js
// PURPOSE: Express routes for Physical KYC workflow — schedules, checklists, results, auditor tokens
// CONNECTS TO: modules/vendor/controllers/physicalKYCController.js,
//              modules/vendor/controllers/auditorTokenController.js,
//              middleware/cognitoJwtMiddleware.js

import express from 'express';
import multer from 'multer';
import {
  createSchedule,
  getScheduleByVendorId,
  getSchedule,
  updateScheduleStatus,
  requestReschedule,
  createChecklist,
  getChecklist,
  getChecklistTemplates,
  createResult,
  getResult,
  updateComplianceDecision,
} from '../controllers/physicalKYCController.js';
import {
  generateAuditorToken,
  validateTokenLink,
  sendOTPToAuditor,
  verifyOTPAndCreateSession,
  getAuditorSession,
} from '../controllers/auditorTokenController.js';
import { authenticateCognitoJwt } from '../../../middleware/cognitoJwtMiddleware.js';
import { uploadFileToS3 } from '../../../utils/s3Utils.js';
import * as DynamoVendor from '../models/DynamoVendor.js';

// Valid physical KYC status transitions
const PHYSICAL_KYC_STATUSES = [
  'in_review',
  'physical_kyc_scheduled',
  'physical_kyc_in_progress',
  'physical_kyc_review',
  'approved',
  'rejected',
];

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ─── Schedule Routes (internal auditor, Cognito auth) ────────────────────────

/**
 * POST /api/physical-kyc/schedule
 * Schedule a physical KYC visit for a vendor.
 */
router.post('/schedule', authenticateCognitoJwt, async (req, res) => {
  try {
    const schedule = await createSchedule(req.body);
    return res.status(201).json({ success: true, data: schedule });
  } catch (error) {
    console.error('[Physical KYC] createSchedule error:', error.message);
    return res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/physical-kyc/schedule/vendor/:vendorId
 * Get current active schedule for a vendor.
 */
router.get('/schedule/vendor/:vendorId', authenticateCognitoJwt, async (req, res) => {
  try {
    const schedule = await getScheduleByVendorId(req.params.vendorId);
    return res.status(200).json({ success: true, data: schedule });
  } catch (error) {
    console.error('[Physical KYC] getScheduleByVendorId error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/physical-kyc/schedule/:vendorId/:scheduleId
 * Get specific schedule.
 */
router.get('/schedule/:vendorId/:scheduleId', authenticateCognitoJwt, async (req, res) => {
  try {
    const schedule = await getSchedule(req.params.vendorId, req.params.scheduleId);
    if (!schedule) {
      return res.status(404).json({ success: false, message: 'Schedule not found' });
    }
    return res.status(200).json({ success: true, data: schedule });
  } catch (error) {
    console.error('[Physical KYC] getSchedule error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/physical-kyc/schedule/:vendorId/:scheduleId/status
 * Update schedule status.
 */
router.put('/schedule/:vendorId/:scheduleId/status', authenticateCognitoJwt, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: 'status is required' });
    }
    await updateScheduleStatus(req.params.vendorId, req.params.scheduleId, status);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Physical KYC] updateScheduleStatus error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Vendor Portal Routes (Cognito auth — vendor login) ───────────────────────

/**
 * GET /api/physical-kyc/vendor/status
 * Vendor portal: get current physical KYC status + schedule + checklist.
 */
router.get('/vendor/status', authenticateCognitoJwt, async (req, res) => {
  try {
    const vendorId = req.auth?.sub || req.query.vendorId;
    if (!vendorId) {
      return res.status(400).json({ success: false, message: 'vendorId required' });
    }

    const schedule = await getScheduleByVendorId(vendorId);
    if (!schedule) {
      return res.status(200).json({ success: true, data: null });
    }

    const checklist = schedule.checklistId ? await getChecklist(schedule.checklistId) : null;
    const result = await getResult(vendorId, schedule.scheduleId);

    return res.status(200).json({
      success: true,
      data: { schedule, checklist, result: result || null },
    });
  } catch (error) {
    console.error('[Physical KYC] vendor/status error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/physical-kyc/vendor/reschedule
 * Vendor requests a reschedule. Max 2 attempts before 6-month block.
 */
router.post('/vendor/reschedule', authenticateCognitoJwt, async (req, res) => {
  try {
    const { vendorId, scheduleId, reason } = req.body;
    if (!vendorId || !scheduleId || !reason) {
      return res.status(400).json({ success: false, message: 'vendorId, scheduleId, reason required' });
    }
    const result = await requestReschedule(vendorId, scheduleId, reason);
    return res.status(200).json(result);
  } catch (error) {
    console.error('[Physical KYC] reschedule error:', error.message);
    return res.status(400).json({ success: false, message: error.message });
  }
});

// ─── Checklist Routes ────────────────────────────────────────────────────────

/**
 * POST /api/physical-kyc/checklist
 * Create a checklist template (auditor only).
 */
router.post('/checklist', authenticateCognitoJwt, async (req, res) => {
  try {
    const checklist = await createChecklist(req.body);
    return res.status(201).json({ success: true, data: checklist });
  } catch (error) {
    console.error('[Physical KYC] createChecklist error:', error.message);
    return res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/physical-kyc/checklist/templates
 * Get checklist templates filtered by vendor type and mode.
 */
router.get('/checklist/templates', authenticateCognitoJwt, async (req, res) => {
  try {
    const { vendorType, verificationMode = 'physical' } = req.query;
    if (!vendorType) {
      return res.status(400).json({ success: false, message: 'vendorType required' });
    }
    const templates = await getChecklistTemplates(vendorType, verificationMode);
    return res.status(200).json({ success: true, data: templates });
  } catch (error) {
    console.error('[Physical KYC] getChecklistTemplates error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/physical-kyc/checklist/:checklistId
 * Get a specific checklist by ID.
 */
router.get('/checklist/:checklistId', authenticateCognitoJwt, async (req, res) => {
  try {
    const checklist = await getChecklist(req.params.checklistId);
    if (!checklist) {
      return res.status(404).json({ success: false, message: 'Checklist not found' });
    }
    return res.status(200).json({ success: true, data: checklist });
  } catch (error) {
    console.error('[Physical KYC] getChecklist error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Result / Evidence Routes ─────────────────────────────────────────────────

/**
 * POST /api/physical-kyc/result
 * Submit physical KYC result (auditor).
 */
router.post('/result', authenticateCognitoJwt, async (req, res) => {
  try {
    const result = await createResult(req.body);

    // Update schedule status to physical_kyc_review
    await updateScheduleStatus(req.body.vendorId, req.body.scheduleId, 'completed');

    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    console.error('[Physical KYC] createResult error:', error.message);
    return res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/physical-kyc/result/:vendorId/:scheduleId
 * Get result for a specific schedule.
 */
router.get('/result/:vendorId/:scheduleId', authenticateCognitoJwt, async (req, res) => {
  try {
    const result = await getResult(req.params.vendorId, req.params.scheduleId);
    if (!result) {
      return res.status(404).json({ success: false, message: 'Result not found' });
    }
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('[Physical KYC] getResult error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/physical-kyc/evidence
 * Upload evidence files to S3.
 * Accepts: PDF (25MB), images (10MB), videos (100MB).
 */
router.post('/evidence', authenticateCognitoJwt, upload.array('files', 20), async (req, res) => {
  try {
    const { vendorId, scheduleId } = req.body;
    if (!vendorId || !scheduleId) {
      return res.status(400).json({ success: false, message: 'vendorId and scheduleId required' });
    }

    const FILE_LIMITS = {
      'application/pdf': 25 * 1024 * 1024,
      'image/jpeg': 10 * 1024 * 1024,
      'image/png': 10 * 1024 * 1024,
      'image/heic': 10 * 1024 * 1024,
      'video/mp4': 100 * 1024 * 1024,
      'video/quicktime': 100 * 1024 * 1024,
    };

    const uploadedFiles = [];
    for (const file of req.files) {
      const limit = FILE_LIMITS[file.mimetype];
      if (!limit) {
        return res.status(400).json({ success: false, message: `File type ${file.mimetype} not allowed` });
      }
      if (file.size > limit) {
        return res.status(400).json({ success: false, message: `File ${file.originalname} exceeds size limit` });
      }

      const s3Key = `physical-kyc/${vendorId}/${scheduleId}/${Date.now()}-${file.originalname}`;
      const url = await uploadFileToS3(file.buffer, s3Key, file.mimetype);
      uploadedFiles.push({ fileName: file.originalname, s3Key, url, mimeType: file.mimetype, size: file.size });
    }

    return res.status(200).json({ success: true, data: uploadedFiles });
  } catch (error) {
    console.error('[Physical KYC] evidence upload error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Compliance Lead Routes ───────────────────────────────────────────────────

/**
 * PUT /api/physical-kyc/result/:vendorId/:scheduleId/compliance
 * Compliance Lead approves or rejects the physical KYC result.
 * Also updates vendor status to 'approved' or 'rejected'.
 */
router.put('/result/:vendorId/:scheduleId/compliance', authenticateCognitoJwt, async (req, res) => {
  try {
    const { decision, reviewNotes } = req.body;
    const reviewerId = req.auth?.sub;
    const { vendorId } = req.params;

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: "decision must be 'approved' or 'rejected'" });
    }

    // Update KYC result with compliance decision
    await updateComplianceDecision(
      vendorId,
      req.params.scheduleId,
      decision,
      reviewerId,
      reviewNotes
    );

    // Update vendor status in vendors table to reflect final decision
    const vendor = await DynamoVendor.getVendorById(vendorId);
    if (vendor) {
      const updateData = {
        status: decision,
        physicalKYCCompletedAt: new Date().toISOString(),
      };
      if (decision === 'rejected' && reviewNotes) {
        updateData.rejectionReason = reviewNotes;
      }
      await DynamoVendor.updateVendor(vendor.id || vendor.vendorId, updateData);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Physical KYC] complianceDecision error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/physical-kyc/vendor/:vendorId/status
 * Update vendor status for physical KYC transitions (in_review, scheduled, in_progress, review).
 */
router.put('/vendor/:vendorId/status', authenticateCognitoJwt, async (req, res) => {
  try {
    const { status } = req.body;
    const { vendorId } = req.params;

    if (!PHYSICAL_KYC_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${PHYSICAL_KYC_STATUSES.join(', ')}`,
      });
    }

    const vendor = await DynamoVendor.getVendorById(vendorId);
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    await DynamoVendor.updateVendor(vendor.id || vendor.vendorId, {
      status,
      updatedAt: new Date().toISOString(),
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Physical KYC] vendor status update error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Third-Party Auditor Portal Routes (no Cognito — secure link + OTP) ──────

/**
 * POST /api/physical-kyc/auditor-token
 * Generate a secure portal link for a third-party auditor (internal call).
 */
router.post('/auditor-token', authenticateCognitoJwt, async (req, res) => {
  try {
    const token = await generateAuditorToken(req.body);
    return res.status(201).json({ success: true, data: { tokenId: token.tokenId, expiresAt: token.expiresAt } });
  } catch (error) {
    console.error('[Physical KYC] generateAuditorToken error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/physical-kyc/auditor-portal/:tokenId
 * Validate the portal link (check expiry before showing OTP screen).
 */
router.get('/auditor-portal/:tokenId', async (req, res) => {
  try {
    const token = await validateTokenLink(req.params.tokenId);
    return res.status(200).json({
      success: true,
      data: {
        auditorName: token.auditorName,
        auditFirm: token.auditFirm,
        isVerified: token.otpVerified,
      },
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/physical-kyc/auditor-portal/:tokenId/send-otp
 * Trigger OTP delivery to the auditor's email/phone.
 */
router.post('/auditor-portal/:tokenId/send-otp', async (req, res) => {
  try {
    const { method, contact } = req.body;
    if (!method || !contact) {
      return res.status(400).json({ success: false, message: 'method and contact required' });
    }
    const result = await sendOTPToAuditor(req.params.tokenId, method, contact);
    return res.status(200).json(result);
  } catch (error) {
    console.error('[Physical KYC] sendOTP error:', error.message);
    return res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/physical-kyc/auditor-portal/:tokenId/verify-otp
 * Verify OTP and issue a session token for the portal.
 */
router.post('/auditor-portal/:tokenId/verify-otp', async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) {
      return res.status(400).json({ success: false, message: 'otp required' });
    }
    const session = await verifyOTPAndCreateSession(req.params.tokenId, otp);
    return res.status(200).json(session);
  } catch (error) {
    console.error('[Physical KYC] verifyOTP error:', error.message);
    return res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/physical-kyc/auditor-portal/:tokenId/data
 * Get schedule + checklist data for the auditor portal (session required).
 */
router.get('/auditor-portal/:tokenId/data', async (req, res) => {
  try {
    const sessionToken = req.headers['x-session-token'];
    if (!sessionToken) {
      return res.status(401).json({ success: false, message: 'x-session-token header required' });
    }

    const token = await getAuditorSession(req.params.tokenId, sessionToken);
    const schedule = await getSchedule(undefined, token.scheduleId).catch(() => null)
      || await getScheduleByVendorId(token.scheduleId).catch(() => null);

    // Fetch by scheduleId via GSI or fallback
    const checklist = schedule?.checklistId ? await getChecklist(schedule.checklistId) : null;

    return res.status(200).json({
      success: true,
      data: {
        auditorName: token.auditorName,
        auditFirm: token.auditFirm,
        schedule,
        checklist,
      },
    });
  } catch (error) {
    console.error('[Physical KYC] auditor portal data error:', error.message);
    return res.status(401).json({ success: false, message: error.message });
  }
});

export default router;
