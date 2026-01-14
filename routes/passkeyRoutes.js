import express from 'express';
import * as passkeyController from '../controllers/passkeyController.js';

const router = express.Router();

/**
 * POST /api/auth/passkey/registration-options
 * Get options for passkey registration
 */
router.post('/registration-options', passkeyController.getRegistrationOptions);

/**
 * POST /api/auth/passkey/register
 * Register a new passkey for the user
 */
router.post('/register', passkeyController.registerPasskey);

/**
 * POST /api/auth/passkey/mfa-verification-options
 * Get options for MFA verification after password login
 */
router.post('/mfa-verification-options', passkeyController.getMFAVerificationOptions);

/**
 * POST /api/auth/passkey/verify-mfa
 * Verify passkey MFA after password login
 */
router.post('/verify-mfa', passkeyController.verifyPasskeyMFA);

/**
 * GET /api/auth/passkey/user-status
 * Get user's passkey registration status
 */
router.get('/user-status', passkeyController.getUserPasskeyStatus);

/**
 * POST /api/auth/passkey/send-otp
 * Send OTP for MFA fallback
 */
router.post('/send-otp', passkeyController.sendOTP);

/**
 * POST /api/auth/passkey/verify-otp
 * Verify OTP for MFA fallback
 */
router.post('/verify-otp', passkeyController.verifyOTP);

export default router;
