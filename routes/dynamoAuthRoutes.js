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
import { seedRolesForOrg, provisionOrgOwner } from '../modules/rbac/scripts/seedDefaults.js';
import { v4 as uuidv4 } from 'uuid';
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

async function getVendorAccessGateByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return { allowed: true };
  }

  try {
    const { DynamoDBDocumentClient, QueryCommand, UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const _ddb = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const _doc = DynamoDBDocumentClient.from(_ddb);

    const result = await _doc.send(new QueryCommand({
      TableName: process.env.RBAC_MEMBERS_TABLE || 'rbac_members',
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': normalizedEmail },
      ProjectionExpression: 'orgId, userId, orgType, #s, roleId, roleName, suspendedUntil, suspensionReason',
      ExpressionAttributeNames: { '#s': 'status' },
      Limit: 20,
    }));

    const allMemberships = result.Items || [];
    const vendorMemberships = allMemberships.filter((m) => m.orgType === 'vendor');
    const scoped = vendorMemberships.length ? vendorMemberships : allMemberships;

    if (!scoped.length) {
      return { allowed: true };
    }

    const hasActiveSuperAdmin = scoped.some((m) => {
      if (m.status !== 'active') return false;
      const roleId = String(m.roleId || '').toLowerCase();
      const roleName = String(m.roleName || '').toLowerCase();
      return roleId === 'super_admin' || roleId === 'superadmin' || roleName === 'super admin';
    });

    if (hasActiveSuperAdmin) {
      return { allowed: true };
    }

    const hasRemoved = scoped.some((m) => m.status === 'removed');
    const hasActive = scoped.some((m) => m.status === 'active');

    const expiredSuspensions = scoped.filter((m) => {
      if (m.status !== 'suspended') return false;
      const untilMs = m.suspendedUntil ? Date.parse(m.suspendedUntil) : NaN;
      return Number.isFinite(untilMs) && untilMs <= Date.now();
    });

    if (expiredSuspensions.length > 0) {
      const now = new Date().toISOString();
      for (const member of expiredSuspensions) {
        if (!member.orgId || !member.userId) continue;
        try {
          await _doc.send(new UpdateCommand({
            TableName: process.env.RBAC_MEMBERS_TABLE || 'rbac_members',
            Key: { orgId: member.orgId, userId: member.userId },
            UpdateExpression: 'SET #s = :active, updatedAt = :now, unsuspendedAt = :now, unsuspendedBy = :system, unsuspendReason = :reason',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':active': 'active',
              ':now': now,
              ':system': 'system_auto_unsuspend',
              ':reason': 'Suspension duration elapsed',
            },
          }));
        } catch (err) {
          console.warn('[auth] auto-unsuspend failed for member:', err?.message);
        }
      }
      return { allowed: true };
    }

    const activeSuspensions = scoped.filter((m) => {
      if (m.status !== 'suspended') return false;
      const untilMs = m.suspendedUntil ? Date.parse(m.suspendedUntil) : NaN;
      return !Number.isFinite(untilMs) || untilMs > Date.now();
    });

    if (activeSuspensions.length > 0 && !hasActive) {
      const blocked = activeSuspensions
        .slice()
        .sort((a, b) => {
          const aMs = a.suspendedUntil ? Date.parse(a.suspendedUntil) : Number.POSITIVE_INFINITY;
          const bMs = b.suspendedUntil ? Date.parse(b.suspendedUntil) : Number.POSITIVE_INFINITY;
          return aMs - bMs;
        })[0];

      const untilMs = blocked?.suspendedUntil ? Date.parse(blocked.suspendedUntil) : NaN;
      let periodText = 'until it is manually lifted';
      if (Number.isFinite(untilMs)) {
        const remainingMs = Math.max(0, untilMs - Date.now());
        const totalMinutes = Math.ceil(remainingMs / 60000);
        const days = Math.floor(totalMinutes / (24 * 60));
        const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
        const minutes = totalMinutes % 60;
        const pieces = [];
        if (days > 0) pieces.push(`${days}d`);
        if (hours > 0) pieces.push(`${hours}h`);
        if (minutes > 0 || pieces.length === 0) pieces.push(`${minutes}m`);
        periodText = `until ${new Date(untilMs).toLocaleString('en-IN')} (${pieces.join(' ')} remaining)`;
      }

      const reasonText = blocked?.suspensionReason
        ? ` Reason: ${String(blocked.suspensionReason).trim()}`
        : '';

      return {
        allowed: false,
        code: 'RBAC_002',
        message: `Your account has been suspended ${periodText}.${reasonText} Contact the org administrator.`,
      };
    }

    if (hasRemoved && !hasActive) {
      return {
        allowed: false,
        code: 'RBAC_001',
        message: 'You have been removed from this organization.',
      };
    }

    return { allowed: true };
  } catch (err) {
    console.warn('[auth] vendor access gate check failed (allowing login):', err?.message);
    return { allowed: true };
  }
}

// Google login route
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// Google callback route
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "${process.env.VENDOR_FRONTEND_URL}/login" }),
  async (req, res) => {
    try {
      const { email, displayName, id: googleId } = req.user;

      const accessGate = await getVendorAccessGateByEmail(email);
      if (!accessGate.allowed) {
        const frontendUrl = process.env.VENDOR_FRONTEND_URL || process.env.VENDOR_DASH || 'https://www.caasdiglobal.in';
        return res.redirect(`${frontendUrl}/login?error=access_revoked`);
      }

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
      // BUT first \u2014 check if this user was removed from RBAC. If they have a
      // 'removed' record (and no 'active' membership), deny the login entirely.
      if (!vendor && !googleUser) {
        try {
          const { DynamoDBDocumentClient, QueryCommand } = await import('@aws-sdk/lib-dynamodb');
          const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
          const { AdminGetUserCommand } = await import('@aws-sdk/client-cognito-identity-provider');
          const _ddb = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
          const _doc = DynamoDBDocumentClient.from(_ddb);

          // Look up Cognito sub for this email to query rbac_members by userId
          let cognitoSub = null;
          try {
            const cogUser = await cognitoClient.send(new AdminGetUserCommand({
              UserPoolId: process.env.COGNITO_USER_POOL_ID,
              Username: email,
            }));
            cognitoSub = cogUser.UserAttributes?.find(a => a.Name === 'sub')?.Value;
          } catch (_) { /* user may not exist in Cognito yet */ }

          if (cognitoSub) {
            const memResult = await _doc.send(new QueryCommand({
              TableName: process.env.RBAC_MEMBERS_TABLE || 'rbac_members',
              IndexName: 'UserOrgsIndex',
              KeyConditionExpression: 'userId = :uid',
              ExpressionAttributeValues: { ':uid': cognitoSub },
              ProjectionExpression: '#s',
              ExpressionAttributeNames: { '#s': 'status' },
              Limit: 10,
            }));
            const hasRemoved = memResult.Items?.some(m => m.status === 'removed');
            const hasActive = memResult.Items?.some(m => m.status === 'active');
            if (hasRemoved && !hasActive) {
              console.warn(`[Google OAuth] Blocked removed user ${email} from creating google_users record`);
              const frontendUrl = process.env.VENDOR_FRONTEND_URL || 'https://www.caasdiglobal.in';
              return res.redirect(`${frontendUrl}/login?error=access_revoked`);
            }
          }
        } catch (checkErr) {
          console.warn('[Google OAuth] Removal check failed:', checkErr?.message);
        }

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
    let user;    // ownerUserId = Cognito sub (JWT path) or Google user's cognitoId.
    // Used to create the rbac_members owner record after org creation.
    let ownerUserId = null;
    // Handle Google authentication (Passport.js session)
    if (req.user) {
      console.log("Attempting to update role for user ID:", req.user._id);
      if (req.user.email) {
        user = await DynamoGoogleUser.getGoogleUserByEmail(req.user.email);
        if (user) {
          console.log("Found user in DynamoDB Google users:", user.email);
          // Capture Cognito sub if the Google user record has one
          ownerUserId = user.cognitoId || user.userId || null;
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
      ownerUserId = userId; // capture for RBAC provisioning after auth block
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
      console.log('[set-role] Updating users table for:', normalizedEmail, 'role:', role);
      const existingUser = await DynamoUser.getUserByEmail(normalizedEmail);
      console.log('[set-role] Existing users record:', existingUser ? `id=${existingUser.userId || existingUser.id} roleSelected=${existingUser.roleSelected}` : 'NOT FOUND');
      if (existingUser) {
        const updated = await DynamoUser.updateUser(existingUser.userId || existingUser.id, {
          lastSelectedRole: role,
          lastSelectedRoleUpdatedAt: now,
          roleSelected: true,
          isOrgOwner: true,
          accountType: 'owner',
        });
        console.log('[set-role] Updated users record:', updated ? `roleSelected=${updated.roleSelected} lastSelectedRole=${updated.lastSelectedRole}` : 'update returned null');
      } else {
        const created = await DynamoUser.createUser({
          email: normalizedEmail,
          displayName: user.displayName,
          lastSelectedRole: role,
          lastSelectedRoleUpdatedAt: now,
          status: 'pending',
          hasFilledForm: false,
          roleSelected: true,
          isOrgOwner: true,
          accountType: 'owner',
        });
        console.log('[set-role] Created users record:', created ? `id=${created.userId} roleSelected=${created.roleSelected}` : 'create returned null');
      }
      // Read-back verify — if the table write failed silently this will reveal it
      const verify = await DynamoUser.getUserByEmail(normalizedEmail);
      console.log('[set-role] Read-back verify:', verify ? `roleSelected=${verify.roleSelected} lastSelectedRole=${verify.lastSelectedRole}` : 'RECORD NOT FOUND AFTER WRITE');
    } catch (err) {
      console.error('[set-role] Failed to update USERS table:', err?.message, err?.stack);
      if (user?.id) {
        await DynamoGoogleUser.updateGoogleUser(user.id, { role, roleSelected: true });
      }
    }

    // ── Resolve parentOrgId ───────────────────────────────────────────────────
    // parentOrgId is the stable org identity generated when the users record is
    // first created (DynamoUser.createUser). It is used as the RBAC orgId for
    // both vendor and client provisioning, eliminating any cross-service HTTP
    // dependency from this critical path.
    let parentOrgId = null;
    {
      const resolveEmail = String(user.email || '').trim().toLowerCase();
      try {
        const freshRec = await DynamoUser.getUserByEmail(resolveEmail);
        parentOrgId = freshRec?.parentOrgId || null;
        if (!parentOrgId) {
          // Back-fill: account was created before parentOrgId was introduced
          parentOrgId = uuidv4();
          const recId = freshRec?.userId || freshRec?.id;
          if (recId) await DynamoUser.updateUser(recId, { parentOrgId });
          console.log('[set-role] Back-filled parentOrgId:', parentOrgId, 'for', resolveEmail);
        } else {
          console.log('[set-role] Resolved parentOrgId:', parentOrgId, 'for', resolveEmail);
        }
      } catch (e) {
        console.warn('[set-role] parentOrgId resolution failed (provisioning may be partial):', e?.message);
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
      }
      // Use parentOrgId as the stable RBAC org identity (generated at account creation)
      const vendorRbacOrgId = parentOrgId || vendor.vendorId || vendor.id;
      // Always attempt to provision RBAC (idempotent — skips if records already exist)
      if (vendor && ownerUserId) {
        try {
          await provisionOrgOwner({
            orgId: vendorRbacOrgId,
            orgType: 'vendor',
            orgName: vendor.name || email.split('@')[0],
            userId: ownerUserId,
            email,
          });
          console.log('[set-role] Provisioned RBAC org owner for vendor:', vendorRbacOrgId);
        } catch (seedErr) {
          console.warn('[set-role] Failed to provision RBAC for vendor (non-blocking):', seedErr?.message);
        }
      } else if (vendor) {
        // Fallback: at least seed roles if no userId (e.g. Google path without cognitoId)
        try {
          await seedRolesForOrg(vendorRbacOrgId, 'vendor');
        } catch (seedErr) {
          console.warn('[set-role] Failed to seed roles for vendor (non-blocking):', seedErr?.message);
        }
      }
      // Stamp vendorOrgId on the users record using parentOrgId as the stable org identity
      if (vendor) {
        try {
          const usersRec = await DynamoUser.getUserByEmail(String(user.email || '').trim().toLowerCase());
          if (usersRec) {
            await DynamoUser.updateUser(usersRec.userId || usersRec.id, {
              vendorOrgId: vendorRbacOrgId,
            });
            console.log('[set-role] Stamped vendorOrgId:', vendorRbacOrgId);
          }
        } catch (patchErr) {
          console.warn('[set-role] Failed to stamp vendorOrgId on users record (non-blocking):', patchErr?.message);
        }
      }
      nextRoute = "/Form1";
    }

    // ── Client role provisioning ──────────────────────────────────────────────
    // RBAC setup uses parentOrgId directly — no cross-service HTTP dependency.
    // Client backend profile creation is best-effort and non-blocking.
    if (role === 'client') {
      try {
        const clientEmail = String(user.email || '').trim().toLowerCase();
        console.log('[set-role:client] parentOrgId:', parentOrgId, 'ownerUserId:', ownerUserId);

        if (parentOrgId) {
          // 1. Provision RBAC org owner using the stable parentOrgId
          if (ownerUserId) {
            try {
              await provisionOrgOwner({
                orgId: parentOrgId,
                orgType: 'client',
                orgName: user?.displayName || clientEmail.split('@')[0],
                userId: ownerUserId,
                email: clientEmail,
              });
              console.log('[set-role] Provisioned RBAC org owner for client:', parentOrgId);
            } catch (seedErr) {
              console.warn('[set-role] Failed to provision RBAC for client (non-blocking):', seedErr?.message);
            }
          } else {
            try {
              await seedRolesForOrg(parentOrgId, 'client');
            } catch (seedErr) {
              console.warn('[set-role] Failed to seed roles for client (non-blocking):', seedErr?.message);
            }
          }

          // 2. Stamp clientOrgId on the users record
          try {
            const usersRec = await DynamoUser.getUserByEmail(clientEmail);
            if (usersRec) {
              await DynamoUser.updateUser(usersRec.userId || usersRec.id, {
                clientOrgId: parentOrgId,
              });
              console.log('[set-role] Stamped clientOrgId:', parentOrgId, 'on users record');
            }
          } catch (patchErr) {
            console.warn('[set-role] Failed to stamp clientOrgId (non-blocking):', patchErr?.message);
          }
        } else {
          console.warn('[set-role:client] parentOrgId unavailable — RBAC provisioning skipped');
        }

        // 3. Best-effort: sync client profile in client backend (non-blocking).
        //    Stores client-specific data (companyName, onboarding status, etc.).
        //    Does NOT block role selection — any failure is logged and ignored.
        const clientBackendBase = process.env.CLIENT_BACKEND_URL || 'http://localhost:5004';
        if (token) {
          const serviceAuthHeaders = { Authorization: `Bearer ${token}` };
          axios
            .get(`${clientBackendBase}/client-api/clients/status`, {
              params: { email: user?.email },
              headers: serviceAuthHeaders,
            })
            .then(async (statusRes) => {
              if (!statusRes?.data?.exists) {
                await axios.post(
                  `${clientBackendBase}/client-api/clients`,
                  {
                    email: user?.email,
                    companyName: null,
                    contactName: user?.displayName || String(user?.email || '').split('@')[0],
                  },
                  { headers: serviceAuthHeaders },
                );
                console.log('[set-role] Client profile created in client backend for', user?.email);
              }
            })
            .catch((e) => {
              console.warn('[set-role:client] Client backend profile sync (non-blocking) failed:', e?.response?.status, e?.message);
            });
        }
      } catch (provisionErr) {
        console.error('[set-role:client] PROVISIONING FAILED:', provisionErr?.message, provisionErr?.stack?.split('\n').slice(0, 3).join('\n'));
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

    const resolveMembershipContext = async () => {
      try {
        const { DynamoDBDocumentClient: DocClient, QueryCommand: QCmd, GetCommand: GCmd } = await import('@aws-sdk/lib-dynamodb');
        const { DynamoDBClient: DDBClient } = await import('@aws-sdk/client-dynamodb');
        const _ddb = new DDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
        const _doc = DocClient.from(_ddb);

        const MEMBERS_TABLE = process.env.RBAC_MEMBERS_TABLE || 'rbac_members';
        const ORGS_TABLE = process.env.RBAC_ORGANIZATIONS_TABLE || 'rbac_organizations';

        const memberResult = await _doc.send(new QCmd({
          TableName: MEMBERS_TABLE,
          IndexName: 'EmailIndex',
          KeyConditionExpression: 'email = :email',
          ExpressionAttributeValues: { ':email': normalizedEmail },
          ProjectionExpression: 'orgId, orgType, platformAccess, #s',
          ExpressionAttributeNames: { '#s': 'status' },
          Limit: 5,
        }));

        const activeMember = (memberResult.Items || []).find((m) => m.status === 'active');
        if (!activeMember) {
          return {
            isMember: false,
            memberOrgType: null,
            platformAccess: null,
          };
        }

        let memberOrgType = activeMember.orgType || null;
        if (!memberOrgType && activeMember.orgId) {
          try {
            const orgResult = await _doc.send(new GCmd({
              TableName: ORGS_TABLE,
              Key: { orgId: activeMember.orgId },
              ProjectionExpression: 'orgType',
            }));
            memberOrgType = orgResult.Item?.orgType || null;
          } catch (e) {
            console.warn('[verify] org type lookup failed:', e?.message);
          }
        }

        return {
          isMember: true,
          memberOrgType: memberOrgType || 'vendor',
          platformAccess: Array.isArray(activeMember.platformAccess) ? activeMember.platformAccess : null,
        };
      } catch (e) {
        console.warn('[verify] resolveMembershipContext failed:', e?.message);
        return {
          isMember: false,
          memberOrgType: null,
          platformAccess: null,
        };
      }
    };

    const membershipContext = await resolveMembershipContext();

    const accessGate = await getVendorAccessGateByEmail(normalizedEmail);
    if (!accessGate.allowed) {
      return {
        email: normalizedEmail,
        role: 'vendor',
        lastSelectedRole: null,
        roleSelected: false,
        isTeamMember: false,
        platformAccess: [],
        orgType: membershipContext.memberOrgType,
        accessDenied: {
          code: accessGate.code || 'RBAC_001',
          message: accessGate.message || 'Your access has been revoked.',
        },
        source: 'users',
      };
    }

    // If the user has a vendor record, treat them as vendor by default (prevents new vendor accounts
    // from bouncing to /role-selection when they haven't explicitly selected a role yet).
    // ALWAYS use normalizedEmail — vendor records are created with lowercase email by set-role.
    let vendorRecord = null;
    try {
      vendorRecord = await DynamoVendor.getVendorByEmail(normalizedEmail);
    } catch (e) {
      console.warn('[verify] DynamoVendor.getVendorByEmail failed:', e?.message);
    }
    console.log(`[verify] email=${normalizedEmail} vendorRecord=${vendorRecord ? vendorRecord.vendorId : 'null'}`);

    let userRecord = null;
    try {
      userRecord = await DynamoUser.getUserByEmail(normalizedEmail);
      console.log(`[verify] userRecord for ${normalizedEmail}:`, userRecord ? `roleSelected=${userRecord.roleSelected} lastSelectedRole=${userRecord.lastSelectedRole}` : 'NOT FOUND');
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
          isMember = membershipContext.isMember;
          memberOrgType = membershipContext.memberOrgType;
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
        if (membershipContext.isMember) {
          isKnownTeamMember = true;
          if (!userRecord.lastSelectedRole && membershipContext.memberOrgType) {
            userRecord.lastSelectedRole = membershipContext.memberOrgType;
          }
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
    if (Array.isArray(membershipContext.platformAccess)) {
      platformAccess = membershipContext.platformAccess;
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
      orgType: membershipContext.memberOrgType,
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
    if (payload?.accessDenied?.code) {
      return res.status(403).json({
        error: 'Access revoked',
        code: payload.accessDenied.code,
        message: payload.accessDenied.message,
      });
    }
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
      if (payload?.accessDenied?.code) {
        return res.status(403).json({
          error: 'Access revoked',
          code: payload.accessDenied.code,
          message: payload.accessDenied.message,
        });
      }
      return res.json(payload);
    } catch (err) {
      console.error("Error verifying token:", err.stack);
      return res.status(401).json({ error: "Not authenticated" });
    }
  }
  return res.status(401).json({ error: "Not authenticated" });
});

export default router;