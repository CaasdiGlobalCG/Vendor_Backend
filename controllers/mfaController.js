import { DynamoVendor } from '../models/DynamoVendor.js';
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
        qrCode: secret.otpauth_url
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
    const vendorId = req.auth?.sub;
    let { totpSecret, verificationCode } = req.body;

    if (!vendorId || !totpSecret || !verificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: totpSecret, verificationCode'
      });
    }

    // Clean up inputs
    totpSecret = totpSecret.trim();
    verificationCode = verificationCode.trim();

    // Debug logging
    console.log('TOTP Setup Verification Debug:');
    console.log('- Secret length:', totpSecret.length);
    console.log('- Secret (first 10 chars):', totpSecret.substring(0, 10) + '...');
    console.log('- Verification Code:', verificationCode);
    console.log('- Code length:', verificationCode.length);

    // Verify the code matches the secret
    const isValid = speakeasy.totp.verify({
      secret: totpSecret,
      encoding: 'base32',
      token: verificationCode,
      window: 2 // Allow codes from +/- 2 time windows (±60 seconds)
    });

    console.log('- Verification Result:', isValid);

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    // Get vendor data
    const vendor = await DynamoVendor.getVendorById(vendorId);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Save TOTP secret to vendor record
    const backupCodes = generateBackupCodes();
    await DynamoVendor.updateVendor(vendorId, {
      totpSecret: totpSecret,
      totpEnabled: true,
      backupCodes: backupCodes,
      mfaEnabledAt: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      message: 'TOTP enabled successfully',
      data: {
        backupCodes: backupCodes
      }
    });
  } catch (err) {
    console.error('Error verifying TOTP setup:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to verify TOTP setup'
    });
  }
};

/**
 * Verify TOTP code for login or account changes
 */
export const verifyTOTPCode = async (req, res) => {
  try {
    const vendorId = req.auth?.sub;
    const { totpCode, useBackupCode } = req.body;

    if (!vendorId || !totpCode) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: totpCode'
      });
    }

    // Get vendor data
    const vendor = await DynamoVendor.getVendorById(vendorId);
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
      await DynamoVendor.updateVendor(vendorId, {
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
    const vendorId = req.auth?.sub;

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized - User not authenticated'
      });
    }

    // Get vendor data
    const vendor = await DynamoVendor.getVendorById(vendorId);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Disable TOTP
    await DynamoVendor.updateVendor(vendorId, {
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
    const vendorId = req.auth?.sub;

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized - User not authenticated'
      });
    }

    // Get vendor data
    const vendor = await DynamoVendor.getVendorById(vendorId);
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
 * Generate backup codes
 */
function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    codes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
  }
  return codes;
}
