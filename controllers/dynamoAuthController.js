import { OAuth2Client } from 'google-auth-library';
import * as DynamoVendor from '../modules/vendor/models/DynamoVendor.js';
import * as DynamoGoogleUser from '../models/DynamoGoogleUser.js';

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

    // If not found in either table, create a new Google user
    if (!vendor && !googleUser) {
      console.log("Creating new Google user in DynamoDB:", email);
      
      // Create new Google user
      const newGoogleUserData = {
        googleId,
        displayName: name,
        email,
        role: 'vendor',
        status: 'pending',
        hasFilledForm: false
      };
      
      googleUser = await DynamoGoogleUser.createGoogleUser(newGoogleUserData);
      console.log("Created new Google user:", googleUser);
    }
    
    // Determine status and hasFilledForm based on which record we found
    let status = 'pending';
    let role = 'vendor';
    let hasFilledForm = false;
    
    if (vendor) {
      // Check if form is complete based on vendor data
      hasFilledForm = 
        vendor.hasFilledForm || 
        (vendor.vendorDetails && 
         vendor.companyDetails && 
         vendor.serviceProductDetails && 
         vendor.bankDetails && 
         vendor.complianceCertifications && 
         vendor.additionalDetails);
      
      // Update hasFilledForm if needed
      if (hasFilledForm && !vendor.hasFilledForm) {
        const updatedVendorData = {
          hasFilledForm: true
        };
        
        await DynamoVendor.updateVendor(vendor.id, updatedVendorData);
      }
      
      status = vendor.status || 'pending';
      role = vendor.role || 'vendor';
    } else if (googleUser) {
      // Use data from Google user
      status = googleUser.status || 'pending';
      hasFilledForm = googleUser.hasFilledForm || false;
      role = googleUser.role || 'vendor';
    }
    
    console.log("Google login - user status:", {
      email,
      status,
      hasFilledForm,
      role,
      source: vendor ? 'vendor' : 'googleUser'
    });

    // Redirect back to frontend with user data as query params
    const redirectUrl = `${frontendBaseUrl}/login?email=${encodeURIComponent(email)}&status=${encodeURIComponent(status)}&role=${encodeURIComponent(role)}&filledForm=${hasFilledForm ? 'true' : 'false'}&authToken=${encodeURIComponent(token)}`;
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('Google login error:', error);
    res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};