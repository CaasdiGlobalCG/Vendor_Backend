import { getVendorById, getVendorByEmail, updateVendor } from '../models/DynamoVendor.js';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

/**
 * Setup TOTP for vendor
 * Generates a new TOTP secret and returns the URI for QR code generation
 */
export const setupTOTP = async (req, res) => {
  try {
    const vendorId = req.auth?.sub; // From Cognito JWT
    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized - User not authenticated'
      });
    }

    // Generate TOTP secret
    const secret = speakeasy.generateSecret({
      name: `VendorHub (${vendorId})`,
      issuer: 'VendorHub',
      length: 32
    });

    // Save temporary secret in a cache (or session store) - not yet verified
    // This will be confirmed when user verifies with a code
    // For now, return the secret and URI
    res.status(200).json({
      success: true,
      data: {
        secret: secret.base32,
        qrCode: secret.otpauth_url,
        backupCodes: generateBackupCodes()
      }
    });
  } catch (err) {
    console.error('Error setting up TOTP:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to setup TOTP'
    });
  }
};

/**
 * Verify TOTP code and enable 2FA
 * User provides a TOTP code to verify they can generate codes from the secret
 */
export const verifyTOTPSetup = async (req, res) => {
  try {
    // Don't require vendorId from sub - will look up vendor by email later
    const userEmail = req.auth?.email;
    let { totpSecret, verificationCode } = req.body;

    if (!userEmail || !totpSecret || !verificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: email in auth, totpSecret, verificationCode'
      });
    }

    // Clean up inputs
    totpSecret = totpSecret.trim();
    verificationCode = verificationCode.trim();
    
    // Remove spaces and hyphens from verification code (common when copying)
    verificationCode = verificationCode.replace(/[\s-]/g, '');
    
    // Validate secret format (should be base32 - only A-Z and 2-7)
    if (!/^[A-Z2-7]+=*$/.test(totpSecret)) {
      console.log('Invalid base32 secret:', totpSecret);
      return res.status(400).json({
        success: false,
        message: 'Invalid secret format. Secret must be a valid base32 string.',
      });
    }

    // Validate code format
    if (!/^\d{6}$/.test(verificationCode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid code format. Please enter a 6-digit code.',
        debug: {
          codeLength: verificationCode.length,
          isNumeric: /^\d+$/.test(verificationCode)
        }
      });
    }

    // Debug logging - DETAILED
    console.log('\n========== TOTP SETUP VERIFICATION ==========');
    console.log('User Email:', userEmail);
    console.log('Received Secret:', totpSecret);
    console.log('Secret length:', totpSecret.length);
    console.log('Secret chars:', totpSecret.split('').join(' '));
    console.log('Verification Code:', verificationCode);
    console.log('Server Time (Unix epoch):', Math.floor(Date.now() / 1000));
    console.log('Server Time (ISO):', new Date().toISOString());
    console.log('=========================================\n');

    // Try to verify the code
    let isValid = false;
    let debugInfo = {
      attempts: [],
      secretReceived: totpSecret,
      secretLength: totpSecret.length
    };

    // Try with current time
    try {
      isValid = speakeasy.totp.verify({
        secret: totpSecret,
        encoding: 'base32',
        token: verificationCode,
        window: 2 // Allow codes from +/- 2 time windows (±60 seconds)
      });
      
      debugInfo.attempts.push({
        timeWindow: 'current',
        result: isValid
      });
      
      console.log('[Verify] Standard window (window=2):', isValid);
    } catch (verifyErr) {
      console.error('[Verify] Error:', verifyErr.message);
      debugInfo.attempts.push({
        timeWindow: 'current',
        error: verifyErr.message
      });
    }

    // If verification failed, try to generate what the code SHOULD be (for debugging)
    if (!isValid) {
      let expectedCode = null;
      try {
        expectedCode = speakeasy.totp({
          secret: totpSecret,
          encoding: 'base32',
          time: Math.floor(Date.now() / 1000)
        });
        
        console.log('[Expected] Current time code:', expectedCode);
        console.log('[Expected] User provided:', verificationCode);
        console.log('[Expected] Match:', expectedCode === verificationCode);
        
        // Also try adjacent time windows
        const now = Math.floor(Date.now() / 1000);
        const prevCode = speakeasy.totp({
          secret: totpSecret,
          encoding: 'base32',
          time: now - 30
        });
        const nextCode = speakeasy.totp({
          secret: totpSecret,
          encoding: 'base32',
          time: now + 30
        });
        
        console.log('[Expected] Previous (30s ago):', prevCode);
        console.log('[Expected] Next (30s future):', nextCode);
        
        debugInfo.expectedCode = expectedCode;
        debugInfo.userCode = verificationCode;
        debugInfo.codesMatch = expectedCode === verificationCode;
        debugInfo.previousCode = prevCode;
        debugInfo.nextCode = nextCode;
      } catch (genErr) {
        console.error('[Expected] Error generating code:', genErr.message);
        debugInfo.generationError = genErr.message;
      }

      // Provide helpful error message
      let errorMessage = 'Invalid verification code.';
      if (expectedCode) {
        errorMessage = `Secret received (length: ${totpSecret.length}), but code doesn't match. `;
        errorMessage += `Expected: ${expectedCode}, but got: ${verificationCode}. `;
        errorMessage += 'The secret in your authenticator likely differs from the server secret.';
      }

      console.log('[Result] FAILED - ' + errorMessage);
      return res.status(400).json({
        success: false,
        message: errorMessage,
        debug: debugInfo
      });
    }

    console.log('[Result] SUCCESS - Code matched!\n');

    // Get vendor data using email (since vendorId from JWT sub may not match custom vendorId)
    const vendorEmail = req.auth?.email;
    if (!vendorEmail) {
      console.error('[TOTP] No email in auth context');
      return res.status(401).json({
        success: false,
        message: 'Email not found in authentication context'
      });
    }

    console.log(`[TOTP] Step 1: Looking up vendor by email: ${vendorEmail}`);
    let vendor;
    try {
      vendor = await getVendorByEmail(vendorEmail);
      console.log(`[TOTP] Step 2: Vendor lookup result:`, vendor ? 'Found' : 'Not found');
    } catch (lookupErr) {
      console.error('[TOTP] Step 2 ERROR - Vendor lookup failed:', lookupErr?.message);
      throw lookupErr;
    }

    if (!vendor) {
      console.error(`[TOTP] Vendor not found for email: ${vendorEmail}`);
      return res.status(404).json({
        success: false,
        message: `Vendor not found for email: ${vendorEmail}`
      });
    }

    // Save TOTP secret to vendor record
    console.log(`[TOTP] Step 3: Generating backup codes...`);
    const backupCodes = generateBackupCodes();
    console.log(`[TOTP] Step 4: Updating vendor (ID: ${vendor.vendorId})...`);
    try {
      await updateVendor(vendor.vendorId, {
        totpSecret: totpSecret,
        totpEnabled: true,
        backupCodes: backupCodes,
        mfaEnabledAt: new Date().toISOString()
      });
      console.log(`[TOTP] Step 5: Vendor updated successfully`);
    } catch (updateErr) {
      console.error('[TOTP] Step 5 ERROR - Vendor update failed:', updateErr?.message);
      console.error('[TOTP] Update error stack:', updateErr?.stack);
      throw updateErr;
    }

    console.log(`[TOTP] Step 6: Sending success response...`);
    res.status(200).json({
      success: true,
      message: 'TOTP enabled successfully',
      data: {
        backupCodes: backupCodes
      }
    });
  } catch (err) {
    console.error('[TOTP Setup] Catch block error:');
    console.error('  Error message:', err?.message);
    console.error('  Error code:', err?.code);
    console.error('  Stack:', err?.stack);
    console.error('  Full error:', err);
    
    res.status(500).json({
      success: false,
      message: 'Failed to verify TOTP setup',
      error: err?.message || 'Unknown error',
      debug: {
        errorType: err?.constructor?.name,
        errorCode: err?.code
      }
    });
  }
};

/**
 * Verify TOTP code for login or account changes
 */
export const verifyTOTPCode = async (req, res) => {
  try {
    const userEmail = req.auth?.email;
    const { totpCode, useBackupCode } = req.body;

    if (!userEmail || !totpCode) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: email in auth, totpCode'
      });
    }

    // Get vendor data
    const vendor = await getVendorByEmail(userEmail);
    if (!vendor || !vendor.totpEnabled) {
      return res.status(400).json({
        success: false,
        message: 'TOTP not enabled for this account'
      });
    }

    if (useBackupCode) {
      // Check if backup code matches
      const backupCodes = vendor.backupCodes || [];
      const codeIndex = backupCodes.indexOf(totpCode);
      
      if (codeIndex === -1) {
        return res.status(400).json({
          success: false,
          message: 'Invalid backup code'
        });
      }

      // Remove used backup code
      backupCodes.splice(codeIndex, 1);
      await updateVendor(vendor.vendorId, {
        backupCodes: backupCodes
      });

      return res.status(200).json({
        success: true,
        message: 'Backup code verified'
      });
    }

    // Verify TOTP code
    const isValid = speakeasy.totp.verify({
      secret: vendor.totpSecret,
      encoding: 'base32',
      token: totpCode,
      window: 2
    });

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid TOTP code'
      });
    }

    res.status(200).json({
      success: true,
      message: 'TOTP code verified'
    });
  } catch (err) {
    console.error('Error verifying TOTP code:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to verify TOTP code'
    });
  }
};

/**
 * Disable TOTP for vendor
 */
export const disableTOTP = async (req, res) => {
  try {
    const userEmail = req.auth?.email;

    if (!userEmail) {
      return res.status(401).json({
        success: false,
        message: 'Email not found in authentication context'
      });
    }

    // Get vendor data
    const vendor = await getVendorByEmail(userEmail);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Disable TOTP
    await updateVendor(vendor.vendorId, {
      totpEnabled: false,
      totpSecret: null,
      backupCodes: []
    });

    res.status(200).json({
      success: true,
      message: 'TOTP disabled successfully'
    });
  } catch (err) {
    console.error('Error disabling TOTP:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to disable TOTP'
    });
  }
};

/**
 * Get MFA status for vendor
 */
export const getMFAStatus = async (req, res) => {
  try {
    const userEmail = req.auth?.email;

    if (!userEmail) {
      return res.status(401).json({
        success: false,
        message: 'Email not found in authentication context'
      });
    }

    // Get vendor data
    const vendor = await getVendorByEmail(userEmail);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        totpEnabled: vendor.totpEnabled || false,
        mfaEnabledAt: vendor.mfaEnabledAt || null,
        backupCodesCount: (vendor.backupCodes || []).length
      }
    });
  } catch (err) {
    console.error('Error getting MFA status:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get MFA status'
    });
  }
};

/**
 * Test endpoint - generate current TOTP code for a given secret (for debugging)
 */
export const testTOTPCode = async (req, res) => {
  try {
    const { totpSecret } = req.body;

    if (!totpSecret) {
      return res.status(400).json({
        success: false,
        message: 'Missing totpSecret'
      });
    }

    // Validate secret format
    const cleanSecret = totpSecret.trim();
    if (!/^[A-Z2-7]+=*$/.test(cleanSecret)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid base32 secret format'
      });
    }

    try {
      const currentCode = speakeasy.totp({
        secret: cleanSecret,
        encoding: 'base32'
      });

      // Also generate codes for ±30 seconds for reference
      const now = Math.floor(Date.now() / 1000);
      const prevCode = speakeasy.totp({
        secret: cleanSecret,
        encoding: 'base32',
        time: now - 30
      });

      const nextCode = speakeasy.totp({
        secret: cleanSecret,
        encoding: 'base32',
        time: now + 30
      });

      res.status(200).json({
        success: true,
        data: {
          currentCode: currentCode,
          previousCode: prevCode,
          nextCode: nextCode,
          serverTime: new Date().toISOString(),
          note: 'TOTP codes expire every 30 seconds. Ensure your authenticator app shows a similar code.'
        }
      });
    } catch (verifyErr) {
      console.error('Error generating test code:', verifyErr);
      return res.status(400).json({
        success: false,
        message: 'Invalid secret - cannot generate code',
        error: verifyErr.message
      });
    }
  } catch (err) {
    console.error('Error in testTOTPCode:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to generate test code'
    });
  }
};

/**
 * Generate backup codes
 */
function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    codes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
  }
  return codes;
}
