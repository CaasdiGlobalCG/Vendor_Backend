/**
 * DEPRECATED: This file is no longer used in the application.
 * It has been replaced by DynamoDB implementations.
 * Kept for reference only.
 */

import express from "express";
import passport from "passport";
import Vendor from "../modules/vendor/models/Vendor.js";
import GoogleUser from "../models/GoogleUser.js";
import jwt from "jsonwebtoken"; // Add jsonwebtoken for token validation
import jwkToPem from "jwk-to-pem"; // Convert JWK to PEM for verification
import axios from "axios"; // For fetching JWKS
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();

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
      const { email, displayName, id } = req.user;

      // First try to find by email directly
      let vendor = await Vendor.findOne({ email });
      
      // If not found, try to find by vendorDetails.primaryContactEmail
      if (!vendor) {
        vendor = await Vendor.findOne({ 'vendorDetails.primaryContactEmail': email });
      }

      if (!vendor) {
        // Create new vendor if doesn't exist
        vendor = new Vendor({
          email,
          name: displayName,
          uid: id,
          hasFilledForm: false,
          status: 'pending',
          role: 'vendor',
          vendorDetails: {
            primaryContactName: displayName,
            primaryContactEmail: email
          },
          // Initialize all required fields with empty objects to pass validation
          companyDetails: {},
          serviceProductDetails: {},
          bankDetails: {},
          complianceCertifications: {},
          additionalDetails: {}
        });
        await vendor.save();
      }

      // Check if form is complete based on data - ensure it's a boolean result
      const hasCompletedForm = Boolean(
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
      if (hasCompletedForm && !vendor.hasFilledForm) {
        vendor.hasFilledForm = true;
        await vendor.save();
      }

      console.log("Google callback - vendor status:", {
        email,
        status: vendor.status,
        hasFilledForm: vendor.hasFilledForm,
        role: vendor.role
      });

      // Determine where to redirect based on vendor status and form completion
      let redirectUrl;
      
      if (vendor.status === 'approved' && vendor.hasFilledForm) {
        // If vendor is approved and has filled the form, redirect directly to dashboard
        redirectUrl = `${process.env.VENDOR_FRONTEND_URL}/VendorDashboard?email=${encodeURIComponent(email)}&role=${encodeURIComponent(vendor.role || 'vendor')}`;
      } else {
        // Otherwise, redirect to login with status parameters
        redirectUrl = `${process.env.VENDOR_FRONTEND_URL}/login?token=true&email=${encodeURIComponent(email)}&status=${encodeURIComponent(vendor.status)}&filledForm=${vendor.hasFilledForm ? 'true' : 'false'}&role=${encodeURIComponent(vendor.role || 'vendor')}`;
      }
      
      res.redirect(redirectUrl);
    } catch (err) {
      console.error("OAuth Callback Error:", err);
      res.redirect("${process.env.VENDOR_FRONTEND_URL}/login?error=server");
    }
  }
);
// Role selection route
router.post("/set-role", async (req, res) => {
  const { role } = req.body;
  const token = req.headers.authorization?.split(" ")[1]; // Extract token from Authorization header

  try {
    let user;

    // Handle Google authentication (Passport.js session)
    if (req.user) {
      console.log("Attempting to update role for user ID:", req.user._id);
      user = await GoogleUser.findById(req.user._id);
      if (!user) {
        console.log("User not found in DB for ID:", req.user._id);
        return res.status(404).json({ error: "User not found" });
      }
    }
    // Handle Cognito authentication (JWT token)
    else if (token) {
      // Verify Cognito token
      const decodedToken = jwt.decode(token, { complete: true });
      if (!decodedToken) {
        return res.status(401).json({ error: "Invalid token" });
      }

      const kid = decodedToken.header.kid;
      const pem = getPem(kid);
      if (!pem) {
        return res.status(401).json({ error: "Invalid key ID" });
      }

      // Use promise-based jwt.verify
      const decoded = await new Promise((resolve, reject) => {
        jwt.verify(token, pem, { algorithms: ["RS256"] }, (err, decoded) => {
          if (err) reject(err);
          else resolve(decoded);
        });
      });

      const userId = decoded.sub; // Cognito user sub (unique identifier)
      console.log("Attempting to update role for Cognito user ID:", userId);
      user = await GoogleUser.findOne({ cognitoId: userId }); // Use cognitoId instead of googleId
      if (!user) {
        // Create new user if not found (optional)
        user = new GoogleUser({
          cognitoId: userId,
          email: decoded.email || "", // Add email if available in token
          displayName: decoded.name || "", // Add displayName if available
          role: role,
        });
        await user.save();
        console.log("New user created with Cognito ID:", userId);
      }
    } else {
      console.log("No authenticated user in session or token");
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Update the role
    user.role = role;
    await user.save();
    console.log("Role updated in DB:", user);
    res.json({ message: "Role saved successfully" });
  } catch (err) {
    console.error("Error updating role:", err.stack);
    res.status(500).json({ error: "Failed to save role" });
  }
});

// Verify authentication
router.get("/verify", async (req, res) => {
  if (req.isAuthenticated() && req.user) {
    console.log("Verify endpoint, user:", req.user);
    return res.json({
      googleId: req.user.googleId,
      email: req.user.email,
      role: req.user.role,
    });
  }
  // Add Cognito token verification for /verify
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

      // Use promise-based jwt.verify
      const decoded = await new Promise((resolve, reject) => {
        jwt.verify(token, pem, { algorithms: ["RS256"] }, (err, decoded) => {
          if (err) reject(err);
          else resolve(decoded);
        });
      });

      const userId = decoded.sub;
      const user = await GoogleUser.findOne({ cognitoId: userId }); // Use cognitoId instead of googleId
      if (user) {
        return res.json({
          googleId: user.googleId || null, // Return null if no googleId
          email: user.email,
          role: user.role,
        });
      }
      return res.status(404).json({ error: "User not found" });
    } catch (err) {
      console.error("Error verifying token:", err.stack);
      return res.status(401).json({ error: "Not authenticated" });
    }
  }
  return res.status(401).json({ error: "Not authenticated" });
});

export default router;