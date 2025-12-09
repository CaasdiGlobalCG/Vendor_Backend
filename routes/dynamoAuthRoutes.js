// import express from "express";
// import passport from "passport";
// import * as DynamoVendor from "../modules/vendor/models/DynamoVendor.js";
// import * as DynamoGoogleUser from "../models/DynamoGoogleUser.js";
// import jwt from "jsonwebtoken"; // Add jsonwebtoken for token validation
// import jwkToPem from "jwk-to-pem"; // Convert JWK to PEM for verification
// import axios from "axios"; // For fetching JWKS
// import { CognitoIdentityProviderClient, AdminCreateUserCommand } from "@aws-sdk/client-cognito-identity-provider";
// import dotenv from 'dotenv';
// dotenv.config();
import express from "express";
import passport from "passport";
import * as DynamoVendor from "../modules/vendor/models/DynamoVendor.js";
import * as DynamoGoogleUser from "../models/DynamoGoogleUser.js";
import * as DynamoUser from "../models/DynamoUser.js";
import jwt from "jsonwebtoken"; // Add jsonwebtoken for token validation
import jwkToPem from "jwk-to-pem"; // Convert JWK to PEM for verification
import axios from "axios"; // For fetching JWKS
import { CognitoIdentityProviderClient, AdminCreateUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();
const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

// Fetch and cache Cognito JWKS
let jwks = {};
const fetchJwks = async () => {
  try {
    const response = await axios.get(
      `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}/.well-known/jwks.json`
    );
    jwks = response.data;
  } catch (error) {
    console.error("Error fetching JWKS:", error);
  }
};
fetchJwks(); // Initial fetch

// Function to get PEM from JWKS based on kid
const getPem = (kid) => {
  const key = jwks.keys.find((k) => k.kid === kid);
  return key ? jwkToPem(key) : null;
};

// Google login route
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// Google callback route
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "${process.env.VENDOR_FRONTEND_URL}/login" }),
  async (req, res) => {
    try {
      const { email, displayName, id: googleId } = req.user;

      // First try to find in DynamoDB vendors
      let vendor = await DynamoVendor.getVendorByEmail(email);
      
      // If not found in vendors, try DynamoDB Google users
      let googleUser = null;
      if (!vendor) {
        googleUser = await DynamoGoogleUser.getGoogleUserByEmail(email);
      }

      // If a googleUser was found but is missing a googleId (i.e., was created via Cognito signup first), update it.
      if (googleUser && !googleUser.googleId && googleId) {
        console.log(`Linking Google ID ${googleId} to existing user ${email}`);
        await DynamoGoogleUser.updateGoogleUser(googleUser.id, { googleId: googleId, displayName: displayName });
        // refresh user data after update
        googleUser.googleId = googleId;
        googleUser.displayName = displayName;
      }

      // If not found in either table, create a new Google user
      if (!vendor && !googleUser) {
        console.log("Creating new Google user in DynamoDB:", email);
        
        // Create new Google user
        const newGoogleUserData = {
          googleId,
          displayName,
          email,
          role: 'vendor',
          status: 'pending',
          hasFilledForm: false,
          roleSelected: false
        };
        
        googleUser = await DynamoGoogleUser.createGoogleUser(newGoogleUserData);
        console.log("Created new Google user:", googleUser);

        // Also create a passwordless user in Cognito for the "Forgot Password" flow
        try {
          const params = {
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            Username: email,
            UserAttributes: [
              { Name: "email", Value: email },
              { Name: "email_verified", Value: "true" },
              { Name: "name", Value: displayName },
            ],
            MessageAction: 'SUPPRESS', // Don't send a welcome email
          };
          await cognitoClient.send(new AdminCreateUserCommand(params));
          console.log(`Created corresponding Cognito user for ${email}`);
        } catch (cognitoError) {
          if (cognitoError.name !== 'UsernameExistsException') {
            console.error(`Failed to create Cognito user for ${email}:`, cognitoError);
          } else {
              console.log(`Cognito user for ${email} already exists. Skipping creation.`);
          }
        }
      }

      // Determine status, role selection, and hasFilledForm
      let status = 'pending';
      let role = 'vendor';
      let hasFilledForm = false;
      let roleSelected = false;
      
      if (vendor) {
        // Check if form is complete based on vendor data
        hasFilledForm = Boolean(
          vendor.hasFilledForm || 
          (vendor.vendorDetails && 
           Object.keys(vendor.vendorDetails).length > 0 && 
           vendor.companyDetails && 
           Object.keys(vendor.companyDetails).length > 0 && 
           vendor.serviceProductDetails && 
           Object.keys(vendor.serviceProductDetails).length > 0 && 
           vendor.bankDetails && 
           Object.keys(vendor.bankDetails).length > 0 && 
           vendor.complianceCertifications && 
           Object.keys(vendor.complianceCertifications).length > 0 && 
           vendor.additionalDetails && 
           Object.keys(vendor.additionalDetails).length > 0)
        );
        
        // Update hasFilledForm if needed
        if (hasFilledForm && !vendor.hasFilledForm) {
          const updatedVendorData = { hasFilledForm: true };
          await DynamoVendor.updateVendor(vendor.id, updatedVendorData);
        }
        
        status = vendor.status || 'pending';
        role = vendor.role || 'vendor';
      } else if (googleUser) {
        // Use data from Google user
        status = googleUser.status || 'pending';
        hasFilledForm = googleUser.hasFilledForm || false;
        role = googleUser.role || 'vendor';
        roleSelected = googleUser.roleSelected === true;
      }
      
      console.log("Google callback - user status:", { email, status, hasFilledForm, role, roleSelected, source: vendor ? 'vendor' : 'googleUser' });

      // Determine where to redirect based on role selection, status and form completion
      let redirectUrl;
      if (!roleSelected) {
        redirectUrl = `${process.env.VENDOR_DASH}/role-selection?email=${encodeURIComponent(email)}`;
      } else if (status === 'approved' && hasFilledForm) {
        redirectUrl = `${process.env.VENDOR_DASH}/VendorDashboard?email=${encodeURIComponent(email)}&role=${encodeURIComponent(role)}`;
      } else {
        redirectUrl = `${process.env.VENDOR_DASH}/login?token=true&email=${encodeURIComponent(email)}&status=${encodeURIComponent(status)}&filledForm=${hasFilledForm ? 'true' : 'false'}&role=${encodeURIComponent(role)}`;
      }
      res.redirect(redirectUrl);
    } catch (err) {
      console.error("OAuth Callback Error:", err);
      res.redirect(`${process.env.VENDOR_DASH}/login?error=server`);
    }
  }
);

// Role selection route
router.post("/set-role", async (req, res) => {
  const { role } = req.body;
  const token = req.headers.authorization?.split(" ")[1];

  try {
    if (!role || !["vendor", "client"].includes(role)) {
      return res.status(400).json({ error: "Invalid role. Must be 'vendor' or 'client'." });
    }
    let user;

    // Handle Google authentication (Passport.js session)
    if (req.user) {
      console.log("Attempting to update role for user ID:", req.user._id);
      if (req.user.email) {
        user = await DynamoGoogleUser.getGoogleUserByEmail(req.user.email);
        if (user) {
          console.log("Found user in DynamoDB Google users:", user.email);
        }
      }
      if (!user) {
        console.log("User not found in DB for ID:", req.user._id);
        return res.status(404).json({ error: "User not found" });
      }
    }
    // Handle Cognito authentication (JWT token)
    else if (token) {
      const decodedToken = jwt.decode(token, { complete: true });
      if (!decodedToken) {
        return res.status(401).json({ error: "Invalid token" });
      }
      const kid = decodedToken.header.kid;
      const pem = getPem(kid);
      if (!pem) {
        return res.status(401).json({ error: "Invalid key ID" });
      }
      const decoded = await new Promise((resolve, reject) => {
        jwt.verify(token, pem, { algorithms: ["RS256"] }, (err, decoded) => {
          if (err) reject(err);
          else resolve(decoded);
        });
      });

      const userId = decoded.sub;
      const email = decoded.email;
      console.log("Attempting to update role for Cognito user ID:", userId);
      // Prefer users by email
      user = email ? await DynamoGoogleUser.getGoogleUserByEmail(email) : null;
      if (!user && userId) {
        user = await DynamoGoogleUser.createGoogleUser({
          cognitoId: userId,
          email: email || "",
          displayName: decoded.name || (email ? email.split('@')[0] : ""),
          role: role,
          status: 'pending',
          hasFilledForm: false,
          roleSelected: true
        });
        console.log("Created new Dynamo Google user with Cognito ID:", userId);
      }
    } else {
      console.log("No authenticated user in session or token");
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Update USERS table (idempotent) and mark roleSelected=true
    try {
      const existingUser = await DynamoUser.getUserByEmail(user.email);
      if (existingUser) {
        await DynamoUser.updateUser(existingUser.userId || existingUser.id, { lastSelectedRole: role, roleSelected: true });
      } else {
        await DynamoUser.createUser({ email: user.email, displayName: user.displayName, lastSelectedRole: role, status: 'pending', hasFilledForm: false, roleSelected: true });
      }
      console.log("lastSelectedRole updated in USERS table:", user.email, role);
    } catch (err) {
      console.warn('Failed to update USERS table, falling back to google_users:', err?.message);
      if (user?.id) {
        await DynamoGoogleUser.updateGoogleUser(user.id, { role, roleSelected: true });
      }
    }

    // Decide next route and ensure vendor presence if needed
    let nextRoute = "/client-onboarding";
    if (role === "vendor") {
      const email = user.email;
      let vendor = email ? await DynamoVendor.getVendorByEmail(email) : null;
      if (!vendor && email) {
        vendor = await DynamoVendor.createVendor({ email, name: user.displayName || email.split('@')[0], status: 'pending', hasFilledForm: false });
        console.log("Created vendor record for:", email);
      }
      nextRoute = "/Form1";
    }

    // If role is client, ensure client profile exists via client-backend (idempotent)
    if (role === 'client') {
      try {
        const clientBackendBase = process.env.CLIENT_BACKEND_URL || 'http://localhost:5004';
        const userEmail = user?.email;
        if (userEmail) {
          const statusRes = await axios.get(`${clientBackendBase}/client-api/clients/status`, { params: { email: userEmail } });
          const exists = Boolean(statusRes?.data?.exists);
          if (!exists) {
            await axios.post(`${clientBackendBase}/client-api/clients`, {
              email: userEmail,
              companyName: null,
              contactName: user?.displayName || (userEmail.split('@')[0]),
            });
            console.log('Provisioned client profile for', userEmail);
          }
        }
      } catch (provisionErr) {
        console.warn('Client provisioning skipped/failed:', provisionErr?.message);
      }
    }

    res.json({ message: "Role saved successfully", role, nextRoute });
  } catch (err) {
    console.error("Error updating role:", err.stack);
    res.status(500).json({ error: "Failed to save role" });
  }
});

// Verify authentication
router.get("/verify", async (req, res) => {
  if (req.isAuthenticated() && req.user) {
    console.log("Verify endpoint, user:", req.user);
    if (req.user.email) {
      const dynamoUser = await DynamoGoogleUser.getGoogleUserByEmail(req.user.email);
      if (dynamoUser) {
        return res.json({
          googleId: dynamoUser.googleId,
          email: dynamoUser.email,
          role: dynamoUser.role || 'vendor',
          roleSelected: dynamoUser.roleSelected === true,
          source: 'dynamodb'
        });
      }
    }
    return res.json({
      googleId: req.user.googleId,
      email: req.user.email,
      role: req.user.role || 'vendor',
      source: 'dynamodb'
    });
  }
  const token = req.headers.authorization?.split(" ")[1];
  if (token) {
    try {
      const decodedToken = jwt.decode(token, { complete: true });
      if (!decodedToken) {
        return res.status(401).json({ error: "Invalid token" });
      }
      const kid = decodedToken.header.kid;
      const pem = getPem(kid);
      if (!pem) {
        return res.status(401).json({ error: "Invalid key ID" });
      }
      const decoded = await new Promise((resolve, reject) => {
        jwt.verify(token, pem, { algorithms: ["RS256"] }, (err, decoded) => {
          if (err) reject(err);
          else resolve(decoded);
        });
      });
      const userId = decoded.sub;
      let dynamoUser = await DynamoGoogleUser.getGoogleUserByEmail(decoded.email);
      if (!dynamoUser) {
        console.log("User not found in DynamoDB, creating new user with email:", decoded.email);
        const newUserData = {
          cognitoId: userId,
          googleId: null,
          email: decoded.email,
          displayName: decoded.name || decoded.email.split('@')[0],
          role: 'vendor',
          status: 'pending',
          hasFilledForm: false,
          roleSelected: false
        };
        dynamoUser = await DynamoGoogleUser.createGoogleUser(newUserData);
        console.log("Created new user in DynamoDB:", dynamoUser);
      }
      if (dynamoUser) {
        return res.json({
          googleId: dynamoUser.googleId || null,
          email: dynamoUser.email,
          role: dynamoUser.role || 'vendor',
          roleSelected: dynamoUser.roleSelected === true,
          source: 'dynamodb'
        });
      }
      return res.status(404).json({ error: "User not found and could not be created" });
    } catch (err) {
      console.error("Error verifying token:", err.stack);
      return res.status(401).json({ error: "Not authenticated" });
    }
  }
  return res.status(401).json({ error: "Not authenticated" });
});

export default router;