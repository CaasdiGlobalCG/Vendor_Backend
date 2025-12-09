/**
 * DEPRECATED: This file is no longer used in the application.
 * It has been replaced by DynamoDB implementations.
 * Kept for reference only.
 */


import { OAuth2Client } from 'google-auth-library';
import Vendor from '../modules/vendor/models/Vendor.js';
import * as DynamoGoogleUser from '../models/DynamoGoogleUser.js';
import * as DynamoVendor from '../modules/vendor/models/DynamoVendor.js';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

import dotenv from 'dotenv';
dotenv.config();

const PROD_FRONTEND_BASE = 'https://www.caasdiglobal.in';
const DEV_FRONTEND_BASE = 'http://localhost:5173';
const frontendBaseUrl =
  process.env.VENDOR_FRONTEND_URL ||
  (process.env.NODE_ENV === 'production' ? PROD_FRONTEND_BASE : DEV_FRONTEND_BASE);

export const googleLogin = async (req, res) => {
  try {
    const { token } = req.body || {}; // Handle token from initial request or callback

    // Verify Google token if provided in the initial request
    let payload;
    if (token) {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } else {
      // Handle callback with code (if using authorization code flow)
      const { code } = req.query;
      if (!code) {
        return res.status(400).json({ success: false, message: 'No code provided' });
      }
      // Exchange code for tokens (implement OAuth2 flow if needed)
      // For simplicity, assume token is passed initially; adjust if using code flow
      return res.status(400).json({ success: false, message: 'Code flow not implemented' });
    }

    const { email, name, picture, sub: googleId } = payload;

    // First try to find in DynamoDB vendors
    let vendor = await DynamoVendor.getVendorByEmail(email);
    
    // If not found in vendors, try DynamoDB Google users
    let googleUser = null;
    if (!vendor) {
      googleUser = await DynamoGoogleUser.getGoogleUserByEmail(email);
    }
    
    // If not found in either DynamoDB collection, check if it's a Google user by googleId
    if (!vendor && !googleUser) {
      googleUser = await DynamoGoogleUser.getGoogleUserByGoogleId(googleId);
    }
    
    // If still not found, create a new Google user in DynamoDB
    if (!vendor && !googleUser) {
      const newGoogleUserData = {
        googleId,
        displayName: name,
        email,
        role: 'vendor',
        status: 'pending',
        hasFilledForm: false
      };
      
      googleUser = await DynamoGoogleUser.createGoogleUser(newGoogleUserData);
      console.log(`Created new Google user in DynamoDB: ${email}`);
    }
    
    // Determine user status and hasFilledForm
    let status, hasFilledForm, role;
    
    if (vendor) {
      // User exists as a vendor
      status = vendor.status || 'pending';
      hasFilledForm = vendor.hasFilledForm || false;
      role = vendor.role || 'vendor';
      
      // Check if form is complete based on data
      const isFormComplete = 
        vendor.hasFilledForm || 
        (vendor.vendorDetails && Object.keys(vendor.vendorDetails).length > 0 &&
         vendor.companyDetails && Object.keys(vendor.companyDetails).length > 0 &&
         vendor.serviceProductDetails && Object.keys(vendor.serviceProductDetails).length > 0 &&
         vendor.bankDetails && Object.keys(vendor.bankDetails).length > 0 &&
         vendor.complianceCertifications && Object.keys(vendor.complianceCertifications).length > 0 &&
         vendor.additionalDetails && Object.keys(vendor.additionalDetails).length > 0);
      
      // Update hasFilledForm if needed
      if (isFormComplete && !vendor.hasFilledForm) {
        await DynamoVendor.updateVendor(vendor.id, { hasFilledForm: true });
        hasFilledForm = true;
      }
    } else if (googleUser) {
      // User exists as a Google user
      status = googleUser.status || 'pending';
      hasFilledForm = googleUser.hasFilledForm || false;
      role = googleUser.role || 'vendor';
      
      // Update Google user with latest info if needed
      if (googleUser.displayName !== name || !googleUser.googleId) {
        await DynamoGoogleUser.updateGoogleUser(googleUser.id, { 
          displayName: name,
          googleId: googleId
        });
      }
    }
    
    console.log("Google login - user status:", {
      email,
      status,
      hasFilledForm,
      role,
      userType: vendor ? 'vendor' : 'google_user'
    });

    // Redirect back to frontend with user data as query params, including status and hasFilledForm
    const redirectUrl = `${frontendBaseUrl}/login?email=${encodeURIComponent(email)}&status=${encodeURIComponent(status || 'pending')}&role=${encodeURIComponent(role || 'vendor')}&filledForm=${hasFilledForm ? 'true' : 'false'}`;
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('Google login error:', error);
    res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};