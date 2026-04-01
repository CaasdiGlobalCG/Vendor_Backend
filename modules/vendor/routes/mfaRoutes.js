import express from 'express';
import { authenticateCognitoJwt } from '../../../middleware/cognitoJwtMiddleware.js';
import {
  setupTOTP,
  verifyTOTPSetup,
  verifyTOTPCode,
  disableTOTP,
  getMFAStatus,
  testTOTPCode
} from '../controllers/mfaController.js';

const router = express.Router();

// All MFA routes require JWT authentication
router.use(authenticateCognitoJwt);

/**
 * POST /api/vendor/mfa/setup
 * Generate TOTP secret and QR code URI
 */
router.post('/setup', setupTOTP);

/**
 * POST /api/vendor/mfa/verify-setup
 * Verify TOTP code and enable 2FA
 * Body: { totpSecret, verificationCode }
 */
router.post('/verify-setup', verifyTOTPSetup);

/**
 * POST /api/vendor/mfa/verify
 * Verify TOTP code or backup code
 * Body: { totpCode, useBackupCode? }
 */
router.post('/verify', verifyTOTPCode);

/**
 * POST /api/vendor/mfa/disable
 * Disable TOTP 2FA
 */
router.post('/disable', disableTOTP);

/**
 * GET /api/vendor/mfa/status
 * Get MFA status for current user
 */
router.get('/status', getMFAStatus);

/**
 * POST /api/vendor/mfa/test-code
 * Generate current TOTP code for debugging (testing only)
 * Body: { totpSecret }
 */
router.post('/test-code', testTOTPCode);

export default router;
