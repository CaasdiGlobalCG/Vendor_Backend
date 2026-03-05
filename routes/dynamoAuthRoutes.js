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
import { seedRolesForOrg } from '../modules/rbac/scripts/seedDefaults.js';
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();
const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

// Fetch and cache Cognito JWKS
let jwks = { keys: [] };
let lastFetchedAt = 0;
const JWKS_REFRESH_MS = 60 * 60 * 1000; // 1 hour

const fetchJwks = async (force = false) => {
  const now = Date.now();
  if (!force && jwks?.keys?.length && now - lastFetchedAt < JWKS_REFRESH_MS) return;

  const region = process.env.AWS_REGION;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!region || !userPoolId) {
    console.warn('[jwks] Missing AWS_REGION or COGNITO_USER_POOL_ID');
    return;
  }

  try {
    const response = await axios.get(
      `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
      { timeout: 10000 } // 10 second timeout
    );
    jwks = response.data;
    lastFetchedAt = now;
    console.log('[jwks] Successfully fetched JWKS');
  } catch (error) {
    console.error('[jwks] Error fetching JWKS:', error?.message || error);
    // Don't overwrite existing keys on error
  }
};

// Initial fetch (best-effort)
fetchJwks().catch(() => undefined);

// Function to get PEM from JWKS based on kid
const getPem = async (kid) => {
  try {
    let key = jwks?.keys?.find((k) => k.kid === kid);
    if (!key) {
      // Try to refresh JWKS in background
      await fetchJwks(true);
      key = jwks?.keys?.find((k) => k.kid === kid);
    }
    return key ? jwkToPem(key) : null;
  } catch (e) {
    console.error('[jwks] getPem error:', e?.message || e);
    return null;
  }
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
      const pem = await getPem(kid);
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
      const now = new Date().toISOString();
      const normalizedEmail = String(user.email || '').trim().toLowerCase();
      const existingUser = await DynamoUser.getUserByEmail(normalizedEmail);
      if (existingUser) {
        await DynamoUser.updateUser(existingUser.userId || existingUser.id, {
          lastSelectedRole: role,
          lastSelectedRoleUpdatedAt: now,
          roleSelected: true
        });
      } else {
        await DynamoUser.createUser({
          email: normalizedEmail,
          displayName: user.displayName,
          lastSelectedRole: role,
          lastSelectedRoleUpdatedAt: now,
          status: 'pending',
          hasFilledForm: false,
          roleSelected: true
        });
      }
      console.log("lastSelectedRole updated in USERS table:", normalizedEmail, role);
    } catch (err) {
      console.warn('Failed to update USERS table, falling back to google_users:', err?.message);
      if (user?.id) {
        await DynamoGoogleUser.updateGoogleUser(user.id, { role, roleSelected: true });
      }
    }

    // Decide next route and ensure vendor presence if needed.
    // Team members share the org's vendorId/clientId — do NOT create
    // a separate vendor/client record for them.
    let nextRoute = "/client-onboarding";
    const isTeamMember = await (async () => {
      try {
        const normalizedEmail = String(user.email || '').trim().toLowerCase();
        const userRec = await DynamoUser.getUserByEmail(normalizedEmail);
        return userRec?.isTeamMember === true;
      } catch { return false; }
    })();

    if (isTeamMember) {
      // Team members skip record creation — they use the org's existing record.
      nextRoute = role === 'client' ? '/home' : '/VendorDashboard';
    } else if (role === "vendor") {
      const email = String(user.email || '').trim().toLowerCase();
      let vendor = email ? await DynamoVendor.getVendorByEmail(email) : null;
      if (!vendor && email) {
        vendor = await DynamoVendor.createVendor({ email, name: user.displayName || email.split('@')[0], status: 'pending', hasFilledForm: false });
        console.log("Created vendor record for:", email);
        // Seed default RBAC roles for the new vendor org
        try {
          await seedRolesForOrg(vendor.vendorId || vendor.id, 'vendor');
          console.log('Seeded default RBAC roles for vendor:', vendor.vendorId || vendor.id);
        } catch (seedErr) {
          console.warn('Failed to seed RBAC roles for vendor (non-blocking):', seedErr?.message);
        }
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
            const provisionRes = await axios.post(`${clientBackendBase}/client-api/clients`, {
              email: userEmail,
              companyName: null,
              contactName: user?.displayName || (userEmail.split('@')[0]),
            });
            console.log('Provisioned client profile for', userEmail);
            // Seed default RBAC roles for the new client org
            const newClientId = provisionRes?.data?.data?.clientId;
            if (newClientId) {
              try {
                await seedRolesForOrg(newClientId, 'client');
                console.log('Seeded default RBAC roles for client:', newClientId);
              } catch (seedErr) {
                console.warn('Failed to seed RBAC roles for client (non-blocking):', seedErr?.message);
              }
            }
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
  const buildUserVerifyPayload = async ({ email, displayNameFallback, roleFallback }) => {
    if (!email) {
      return {
        email: null,
        role: roleFallback || 'vendor',
        lastSelectedRole: null,
        roleSelected: false,
        source: 'users'
      };
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // If the user has a vendor record, treat them as vendor by default (prevents new vendor accounts
    // from bouncing to /role-selection when they haven't explicitly selected a role yet).
    let vendorRecord = null;
    try {
      vendorRecord = await DynamoVendor.getVendorByEmail(email);
      if (!vendorRecord && normalizedEmail !== email) {
        vendorRecord = await DynamoVendor.getVendorByEmail(normalizedEmail);
      }
    } catch (e) {
      console.warn('[verify] DynamoVendor.getVendorByEmail failed:', e?.message);
    }

    let userRecord = null;
    try {
      userRecord = await DynamoUser.getUserByEmail(email);
      if (!userRecord && normalizedEmail !== email) {
        userRecord = await DynamoUser.getUserByEmail(normalizedEmail);
      }
    } catch (e) {
      console.warn('[verify] DynamoUser.getUserByEmail failed:', e?.message);
    }

    if (!userRecord) {
      try {
        // Before creating a new users record with roleSelected=false, check if
        // this email belongs to a team member (their users record is created during
        // invite acceptance with roleSelected=true). A race condition could mean
        // the record hasn't committed yet, so we also check rbac_members as a safety net.
        let isMember = false;
        let memberOrgType = null;
        if (!vendorRecord) {
          try {
            const { DynamoDBDocumentClient: DocClient, QueryCommand: QCmd } = await import('@aws-sdk/lib-dynamodb');
            const { DynamoDBClient: DDBClient } = await import('@aws-sdk/client-dynamodb');
            const _ddb = new DDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
            const _doc = DocClient.from(_ddb);
            const MEMBERS_TABLE = process.env.RBAC_MEMBERS_TABLE || 'rbac_members';

            const memberResult = await _doc.send(new QCmd({
              TableName: MEMBERS_TABLE,
              IndexName: 'EmailIndex',
              KeyConditionExpression: 'email = :email',
              ExpressionAttributeValues: { ':email': normalizedEmail },
              ProjectionExpression: 'orgId, #s',
              ExpressionAttributeNames: { '#s': 'status' },
              Limit: 1,
            }));
            const activeMember = memberResult.Items?.find(m => m.status === 'active');
            if (activeMember) {
              isMember = true;
              // Determine orgType from rbac_organizations
              try {
                const { GetCommand: GCmd } = await import('@aws-sdk/lib-dynamodb');
                const ORGS_TABLE = process.env.RBAC_ORGANIZATIONS_TABLE || 'rbac_organizations';
                const orgResult = await _doc.send(new GCmd({
                  TableName: ORGS_TABLE,
                  Key: { orgId: activeMember.orgId },
                  ProjectionExpression: 'orgType',
                }));
                memberOrgType = orgResult.Item?.orgType || 'vendor';
              } catch { memberOrgType = 'vendor'; }
            }
          } catch (e) {
            console.warn('[verify] rbac_members check failed:', e?.message);
          }
        }

        userRecord = await DynamoUser.createUser({
          email: normalizedEmail,
          displayName: displayNameFallback || normalizedEmail.split('@')[0],
          lastSelectedRole: vendorRecord ? 'vendor' : (isMember ? memberOrgType : null),
          lastSelectedRoleUpdatedAt: (vendorRecord || isMember) ? new Date().toISOString() : null,
          status: isMember ? 'active' : 'pending',
          hasFilledForm: isMember ? true : false,
          roleSelected: vendorRecord ? true : isMember,
          ...(isMember && { isTeamMember: true }),
        });
      } catch (e) {
        console.warn('[verify] DynamoUser.createUser failed:', e?.message);
      }
    }

    // If a vendor record exists but users.roleSelected is false, fix it up.
    // Only set lastSelectedRole if it's missing, to avoid clobbering explicit client choice.
    if (vendorRecord && userRecord) {
      const needsRoleSelected = userRecord.roleSelected !== true;
      const needsLastRole = !userRecord.lastSelectedRole;
      if (needsRoleSelected || needsLastRole) {
        try {
          const updates = {
            roleSelected: true,
          };
          if (needsLastRole) {
            updates.lastSelectedRole = 'vendor';
            updates.lastSelectedRoleUpdatedAt = new Date().toISOString();
          }
          const id = userRecord.userId || userRecord.id;
          if (id) {
            userRecord = await DynamoUser.updateUser(id, updates);
          }
        } catch (e) {
          console.warn('[verify] Failed to update users roleSelected/lastSelectedRole:', e?.message);
        }
      }
    }

    // If the user is a team member (isTeamMember flag set during invite acceptance)
    // ensure roleSelected is always true to prevent role-selection redirect.
    // Also detect team members whose users record was created before the isTeamMember
    // flag existed — look them up in rbac_members as a fallback.
    if (!vendorRecord && userRecord && userRecord.roleSelected !== true) {
      let isKnownTeamMember = userRecord.isTeamMember === true;

      // If the record doesn't have isTeamMember, check rbac_members directly
      if (!isKnownTeamMember) {
        try {
          const { DynamoDBDocumentClient: DocClient, QueryCommand: QCmd } = await import('@aws-sdk/lib-dynamodb');
          const { DynamoDBClient: DDBClient } = await import('@aws-sdk/client-dynamodb');
          const _ddb = new DDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
          const _doc = DocClient.from(_ddb);
          const MEMBERS_TABLE = process.env.RBAC_MEMBERS_TABLE || 'rbac_members';

          const memberCheck = await _doc.send(new QCmd({
            TableName: MEMBERS_TABLE,
            IndexName: 'EmailIndex',
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: { ':email': normalizedEmail },
            ProjectionExpression: 'orgId, #s, orgType',
            ExpressionAttributeNames: { '#s': 'status' },
            Limit: 5,
          }));
          const activeMember = (memberCheck.Items || []).find(m => m.status === 'active');
          if (activeMember) {
            isKnownTeamMember = true;
            // Determine orgType for lastSelectedRole
            if (!userRecord.lastSelectedRole && activeMember.orgType) {
              userRecord.lastSelectedRole = activeMember.orgType;
            }
          }
        } catch (e) {
          console.warn('[verify] rbac_members fallback check failed:', e?.message);
        }
      }

      if (isKnownTeamMember) {
        try {
          const id = userRecord.userId || userRecord.id;
          if (id) {
            userRecord = await DynamoUser.updateUser(id, {
              roleSelected: true,
              isTeamMember: true,
              ...(userRecord.lastSelectedRole ? {} : { lastSelectedRole: 'vendor', lastSelectedRoleUpdatedAt: new Date().toISOString() }),
            });
          }
        } catch (e) {
          console.warn('[verify] Failed to fix team member roleSelected:', e?.message);
        }
      }
    }

    const lastSelectedRole = userRecord?.lastSelectedRole || null;
    const roleSelected = userRecord?.roleSelected === true;
    const role = (lastSelectedRole || roleFallback || 'vendor');
    const isTeamMember = userRecord?.isTeamMember === true;

    // Resolve platformAccess from rbac_members (for team members + org owners)
    // Org owners who have been backfilled will have a member record with platformAccess.
    // Non-team non-backfilled users default to all platforms.
    let platformAccess = null;
    try {
      const { DynamoDBDocumentClient: DocClient2, QueryCommand: QCmd2 } = await import('@aws-sdk/lib-dynamodb');
      const { DynamoDBClient: DDBClient2 } = await import('@aws-sdk/client-dynamodb');
      const _ddb2 = new DDBClient2({ region: process.env.AWS_REGION || 'us-east-1' });
      const _doc2 = DocClient2.from(_ddb2);
      const MEMBERS_TABLE2 = process.env.RBAC_MEMBERS_TABLE || 'rbac_members';
      const memberPAResult = await _doc2.send(new QCmd2({
        TableName: MEMBERS_TABLE2,
        IndexName: 'EmailIndex',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': normalizedEmail },
        ProjectionExpression: 'platformAccess, #s',
        ExpressionAttributeNames: { '#s': 'status' },
        Limit: 5,
      }));
      const activeMemberPA = (memberPAResult.Items || []).find(m => m.status === 'active');
      if (activeMemberPA && Array.isArray(activeMemberPA.platformAccess)) {
        platformAccess = activeMemberPA.platformAccess;
      }
    } catch (e) {
      console.warn('[verify] platformAccess lookup failed:', e?.message);
    }
    // Default: org owners without rbac_members record get all platforms
    if (!platformAccess) {
      platformAccess = ['vendor', 'client', 'sales'];
    }

    return {
      email,
      role,
      lastSelectedRole,
      roleSelected,
      isTeamMember,
      platformAccess,
      source: 'users'
    };
  };

  if (req.isAuthenticated() && req.user) {
    console.log("Verify endpoint (session), user:", req.user);
    const email = req.user.email;
    const payload = await buildUserVerifyPayload({
      email,
      displayNameFallback: req.user.displayName,
      roleFallback: req.user.role
    });
    return res.json(payload);
  }
  const token = req.headers.authorization?.split(" ")[1];
  if (token) {
    try {
      const decodedToken = jwt.decode(token, { complete: true });
      if (!decodedToken) {
        return res.status(401).json({ error: "Invalid token" });
      }
      const kid = decodedToken.header.kid;
      const pem = await getPem(kid);
      if (!pem) {
        return res.status(401).json({ error: "Invalid key ID" });
      }
      const decoded = await new Promise((resolve, reject) => {
        jwt.verify(token, pem, { algorithms: ["RS256"] }, (err, decoded) => {
          if (err) reject(err);
          else resolve(decoded);
        });
      });
      const email = decoded?.email;
      const payload = await buildUserVerifyPayload({
        email,
        displayNameFallback: decoded?.name,
        roleFallback: 'vendor'
      });
      return res.json(payload);
    } catch (err) {
      console.error("Error verifying token:", err.stack);
      return res.status(401).json({ error: "Not authenticated" });
    }
  }
  return res.status(401).json({ error: "Not authenticated" });
});

export default router;