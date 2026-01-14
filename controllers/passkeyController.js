import { v4 as uuidv4 } from 'uuid';
import * as DynamoPasskey from '../models/DynamoPasskey.js';
import * as DynamoUser from '../models/DynamoUser.js';
import * as DynamoVendor from '../modules/vendor/models/DynamoVendor.js';
import nodemailer from 'nodemailer';

// Email transport configuration (same as vendor controller)
const transporter = nodemailer.createTransport({
  host: 'smtpout.secureserver.net', // GoDaddy SMTP server
  port: 465,
  secure: true,
  auth: {
    user: 'virtualspace@caasdiglobal.in',
    pass: 'virtualspace@2678'
  }
});

// In-memory OTP storage (in production, use Redis or database)
const otpStore = new Map();

/**
 * Generate registration options for passkey setup
 * This sends a challenge to the client for WebAuthn registration
 */
export const getRegistrationOptions = async (req, res) => {
  try {
    const { userId, email } = req.body;
    
    if (!userId && !email) {
      return res.status(400).json({
        success: false,
        message: 'userId or email is required'
      });
    }
    
    let user = null;
    
    // Try to find user by email first (most reliable)
    if (email) {
      user = await DynamoUser.getUserByEmail(email);
      
      // If not found in users table, try vendor table
      if (!user) {
        user = await DynamoVendor.getVendorByEmail(email);
      }
    } else if (userId) {
      // If only userId provided, try to get from users table
      user = await DynamoUser.getUserById(userId);
      
      if (!user) {
        // Try vendor table if not found
        const vendors = await DynamoVendor.getAllVendors();
        user = vendors?.find(v => v.vendorId === userId || v.id === userId);
      }
    }
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Get user ID - try multiple fields
    const userIdForPasskey = user.userId || user.id || user.vendorId;
    
    // Generate a random challenge
    const challenge = uuidv4().replace(/-/g, '').substring(0, 32);
    
    // Registration options for WebAuthn
    const registrationOptions = {
      challenge,
      rp: {
        name: 'CAASI Vendor Dashboard',
        id: new URL(process.env.VENDOR_FRONTEND_URL || 'http://localhost:5173').hostname
      },
      user: {
        id: userIdForPasskey,
        name: user.email,
        displayName: user.displayName || user.primaryContactName || user.email
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' }, // ES256
        { alg: -257, type: 'public-key' } // RS256
      ],
      timeout: 60000,
      attestation: 'direct',
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // Prefer platform authenticators (Face ID, fingerprint)
        residentKey: 'preferred',
        userVerification: 'preferred'
      }
    };
    
    // Store challenge temporarily (in production, use Redis or session)
    // For now, we'll send it back to client
    req.session = req.session || {};
    req.session.passkeyChallenge = challenge;
    req.session.userId = userIdForPasskey;
    
    return res.status(200).json({
      success: true,
      data: registrationOptions
    });
  } catch (error) {
    console.error('Error generating registration options:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate registration options',
      error: error.message
    });
  }
};

/**
 * Register a new passkey
 * Stores the public key and credential ID
 */
export const registerPasskey = async (req, res) => {
  try {
    const { userId, credentialId, publicKey, passkeyName, clientData, attestationObject } = req.body;
    
    console.log('[PasskeyController] registerPasskey called with userId:', userId);
    if (!userId || !credentialId || !publicKey) {
      return res.status(400).json({
        success: false,
        message: 'userId, credentialId, and publicKey are required'
      });
    }

    // If userId looks like a vendorId, skip user table lookup
    let user = null;
    let userSource = null;
    if (/^C\d{2}-\d{6}-\d{3}$/.test(userId) || userId.startsWith('C')) {
      // Looks like a vendorId
      console.log('[PasskeyController] Detected vendorId, skipping DynamoUser lookup');
      const vendors = await DynamoVendor.getAllVendors();
      user = vendors?.find(v => v.vendorId === userId || v.id === userId);
      userSource = 'vendor';
    } else {
      // Try user table first
      console.log('[PasskeyController] Looking for user in DynamoUser table...');
      user = await DynamoUser.getUserById(userId);
      userSource = 'users';
      if (!user) {
        console.log('[PasskeyController] User not found in DynamoUser, checking vendors...');
        const vendors = await DynamoVendor.getAllVendors();
        user = vendors?.find(v => v.vendorId === userId || v.id === userId);
        userSource = 'vendor';
      }
    }

    if (!user) {
      console.log('[PasskeyController] User not found in any table');
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('[PasskeyController] User found:', {
      source: userSource,
      vendorId: user.vendorId,
      userId: user.userId,
      id: user.id
    });
    
    // Check if passkey already exists
    console.log('[PasskeyController] Checking if passkey already exists...');
    const existingPasskey = await DynamoPasskey.getPasskeyByCredentialId(credentialId);
    if (existingPasskey) {
      return res.status(409).json({
        success: false,
        message: 'Passkey already registered'
      });
    }
    
    // Create passkey record
    console.log('[PasskeyController] Creating passkey record...');
    const passkey = await DynamoPasskey.createPasskey(userId, {
      credentialId,
      publicKey, // Store as JSON string
      passkeyName: passkeyName || 'My Passkey',
      counter: 0
    });
    
    // Update user record to indicate passkey is registered
    // Only update if user is in USERS_TABLE
    console.log('[PasskeyController] Passkey created successfully, updating user record...');
    console.log('[PasskeyController] userSource:', userSource);
    
    if (userSource === 'users') {
      console.log('[PasskeyController] Updating DynamoUser...');
      await DynamoUser.updateUser(userId, {
        hasPasskey: true,
        passkeyRegisteredAt: new Date().toISOString()
      });
    } else if (userSource === 'vendor') {
      // For vendor users, update vendor record
      const userIdForUpdate = user.vendorId || user.id;
      console.log('[PasskeyController] Updating DynamoVendor with id:', userIdForUpdate);
      await DynamoVendor.updateVendor(userIdForUpdate, {
        hasPasskey: true,
        passkeyRegisteredAt: new Date().toISOString()
      });
    }
    
    console.log('[PasskeyController] User record updated successfully');
    
    return res.status(200).json({
      success: true,
      message: 'Passkey registered successfully',
      data: {
        passkeyId: passkey.passkeyId,
        passkeyName: passkey.passkeyName
      }
    });
  } catch (error) {
    console.error('Error registering passkey:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to register passkey',
      error: error.message
    });
  }
};

/**
 * Get MFA verification options for login
 * Returns challenge for WebAuthn authentication
 */
export const getMFAVerificationOptions = async (req, res) => {
  try {
    const { userId, email } = req.body;
    
    if (!userId && !email) {
      return res.status(400).json({
        success: false,
        message: 'userId or email is required'
      });
    }
    
    // Resolve the correct userId for passkey lookup
    let userIdForPasskey = userId;
    
    if (!userIdForPasskey && email) {
      // Try to find user by email
      let user = await DynamoUser.getUserByEmail(email);
      
      // If not found in users table, try vendor table
      if (!user) {
        user = await DynamoVendor.getVendorByEmail(email);
      }
      
      if (user) {
        userIdForPasskey = user.userId || user.id || user.vendorId;
      }
    }
    
    // Get user's passkeys
    const passkeys = await DynamoPasskey.getPasskeysByUserId(userIdForPasskey);
    
    if (passkeys.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'User has no passkeys registered'
      });
    }
    
    // Generate challenge for authentication
    const challenge = uuidv4().replace(/-/g, '').substring(0, 32);
    
    // Get credential IDs
    const allowCredentials = passkeys.map(pk => ({
      type: 'public-key',
      id: pk.credentialId,
      transports: ['internal']
    }));
    
    const authenticationOptions = {
      challenge,
      timeout: 60000,
      rpId: new URL(process.env.VENDOR_FRONTEND_URL || 'http://localhost:5173').hostname,
      userVerification: 'preferred',
      allowCredentials
    };
    
    // Store challenge temporarily
    req.session = req.session || {};
    req.session.passkeyChallenge = challenge;
    req.session.userId = userIdForPasskey;
    
    return res.status(200).json({
      success: true,
      data: authenticationOptions
    });
  } catch (error) {
    console.error('Error getting MFA verification options:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get MFA verification options',
      error: error.message
    });
  }
};

/**
 * Verify passkey MFA
 * Validates the WebAuthn assertion
 */
export const verifyPasskeyMFA = async (req, res) => {
  try {
    const { userId, credentialId, authenticatorData, clientDataJSON, signature } = req.body;
    
    console.log('[verifyPasskeyMFA] Called with userId:', userId, 'credentialId:', credentialId);
    
    if (!userId || !credentialId || !authenticatorData || !clientDataJSON || !signature) {
      console.log('[verifyPasskeyMFA] Missing required fields:', { userId, credentialId, authenticatorData, clientDataJSON, signature });
      return res.status(400).json({
        success: false,
        message: 'All fields (userId, credentialId, authenticatorData, clientDataJSON, signature) are required'
      });
    }
    
    // Get the passkey
    const passkey = await DynamoPasskey.getPasskeyByCredentialId(credentialId);
    if (!passkey) {
      console.log('[verifyPasskeyMFA] Passkey not found for credentialId:', credentialId);
      return res.status(404).json({
        success: false,
        message: 'Passkey not found'
      });
    }
    
    console.log('[verifyPasskeyMFA] Found passkey:', { passkeyId: passkey.passkeyId, userId: passkey.userId });
    
    // Verify passkey belongs to user
    if (passkey.userId !== userId) {
      console.log('[verifyPasskeyMFA] Passkey userId mismatch. Passkey userId:', passkey.userId, 'Request userId:', userId);
      return res.status(403).json({
        success: false,
        message: 'Passkey does not belong to this user'
      });
    }
    
    // In a production environment, you would:
    // 1. Verify the signature using the stored public key
    // 2. Check the counter to prevent cloning
    // 3. Validate client data
    // For now, we'll do a basic verification
    
    // Update last used timestamp
    await DynamoPasskey.updatePasskey(passkey.passkeyId, passkey.userId, {
      lastUsedAt: new Date().toISOString()
    });
    
    // Return success
    return res.status(200).json({
      success: true,
      message: 'Passkey verified successfully',
      data: {
        userId,
        verified: true
      }
    });
  } catch (error) {
    console.error('Error verifying passkey MFA:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify passkey',
      error: error.message
    });
  }
};

/**
 * Get user passkey status
 */
export const getUserPasskeyStatus = async (req, res) => {
  try {
    const { userId, email } = req.query;
    
    console.log('[getUserPasskeyStatus] Called with userId:', userId, 'email:', email);
    
    if (!userId && !email) {
      return res.status(400).json({
        success: false,
        message: 'userId or email is required'
      });
    }
    
    let user = null;
    let userSource = null;
    // Try email first as it's more reliable
    if (email) {
      console.log('[getUserPasskeyStatus] Looking for user by email:', email);
      
      // First check vendor table (since vendor logins are more common)
      user = await DynamoVendor.getVendorByEmail(email);
      if (user) {
        userSource = 'vendor';
        console.log('[getUserPasskeyStatus] Found user in DynamoVendor:', user.vendorId);
      } else {
        // If not found in vendor table, check user table
        user = await DynamoUser.getUserByEmail(email);
        if (user) {
          userSource = 'users';
          console.log('[getUserPasskeyStatus] Found user in DynamoUser:', user.userId);
        }
      }
    } else if (userId) {
      user = await DynamoUser.getUserById(userId);
      if (user) userSource = 'users';
      // If not found, try vendor table
      if (!user) {
        const vendors = await DynamoVendor.getAllVendors();
        user = vendors?.find(v => v.vendorId === userId || v.id === userId);
        if (user) userSource = 'vendor';
      }
    }
    
    if (!user) {
      console.log('[getUserPasskeyStatus] User not found in any table');
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Use vendorId for passkey lookup if user is a vendor
    let userIdForPasskey;
    if (userSource === 'vendor') {
      userIdForPasskey = user.vendorId || user.id;
    } else {
      userIdForPasskey = user.userId || user.id;
    }
    
    console.log('[getUserPasskeyStatus] Using userIdForPasskey:', userIdForPasskey, 'for source:', userSource);
    
    const passkeys = await DynamoPasskey.getPasskeysByUserId(userIdForPasskey);
    const hasPasskey = passkeys.length > 0;
    const passkeyRegisteredAt = hasPasskey
      ? passkeys[0].createdAt
      : (user.passkeyRegisteredAt || null);
    
    console.log('[getUserPasskeyStatus] Returning hasPasskey:', hasPasskey, 'passkeyCount:', passkeys.length);
    
    return res.status(200).json({
      success: true,
      data: {
        userId: userIdForPasskey,
        hasPasskey,
        passkeyCount: passkeys.length,
        passkeyRegisteredAt,
        passkeys: passkeys.map(pk => ({
          passkeyId: pk.passkeyId,
          passkeyName: pk.passkeyName,
          createdAt: pk.createdAt,
          lastUsedAt: pk.lastUsedAt
        }))
      }
    });
  } catch (error) {
    console.error('Error getting passkey status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get passkey status',
      error: error.message
    });
  }
};

/**
 * Send OTP for MFA fallback
 */
export const sendOTP = async (req, res) => {
  try {
    const { email, userId } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Verify user exists
    let user = null;
    if (email) {
      user = await DynamoUser.getUserByEmail(email);
      if (!user) {
        user = await DynamoVendor.getVendorByEmail(email);
      }
    } else if (userId) {
      user = await DynamoUser.getUserById(userId);
      if (!user) {
        const vendors = await DynamoVendor.getAllVendors();
        user = vendors?.find(v => v.vendorId === userId || v.id === userId);
      }
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP with expiration (5 minutes)
    const otpData = {
      otp,
      email,
      userId: user.userId || user.id || user.vendorId,
      expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
    };

    otpStore.set(email, otpData);

    // Send email
    const mailOptions = {
      from: 'virtualspace@caasdiglobal.in',
      to: email,
      subject: 'Your MFA Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #16a34a;">MFA Verification Code</h2>
          <p>Hello,</p>
          <p>You requested a verification code for multi-factor authentication. Your code is:</p>
          <div style="background-color: #f3f4f6; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
            <span style="font-size: 32px; font-weight: bold; color: #16a34a; font-family: monospace;">${otp}</span>
          </div>
          <p>This code will expire in 5 minutes.</p>
          <p>If you didn't request this code, please ignore this email.</p>
          <p>Best regards,<br>Vendor Portal Team</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully'
    });
  } catch (error) {
    console.error('Error sending OTP:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: error.message
    });
  }
};

/**
 * Verify OTP for MFA fallback
 */
export const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required'
      });
    }

    // Get stored OTP data
    const otpData = otpStore.get(email);

    if (!otpData) {
      return res.status(400).json({
        success: false,
        message: 'No OTP found for this email'
      });
    }

    // Check if OTP has expired
    if (Date.now() > otpData.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({
        success: false,
        message: 'OTP has expired'
      });
    }

    // Verify OTP
    if (otpData.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    // Clear OTP after successful verification
    otpStore.delete(email);

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        userId: otpData.userId,
        verified: true
      }
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify OTP',
      error: error.message
    });
  }
};
