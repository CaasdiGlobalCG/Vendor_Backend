// ============================================================
// FILE: middleware/attachVendorId.js
// PURPOSE: Resolves the vendor's orgId (vendorId) from the authenticated
//          user's email using the vendors table EmailIndex GSI.
//          For team members (no vendor record), falls back to rbac_members
//          UserOrgsIndex to find their orgId and sets req.isTeamMember.
//          Sets req.vendorId — single source of truth for all downstream
//          middleware and controllers (RBAC, workspace, leads, etc.).
// CONNECTS TO: cognitoJwtMiddleware.js (needs req.auth.email + req.auth.sub),
//              vendors table (EmailIndex GSI),
//              rbac_members table (UserOrgsIndex GSI — fallback for team members),
//              attachRBAC.js (consumes req.vendorId)
// ============================================================

import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const VENDORS_TABLE = process.env.VENDORS_TABLE || 'vendors';
const MEMBERS_TABLE = process.env.RBAC_MEMBERS_TABLE || 'rbac_members';

// Reusable v3 doc client — shared across all requests
const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * Middleware: Resolve vendorId from the authenticated user's email.
 *
 * Strategy:
 * 1. If vendorId already set → skip
 * 2. Check vendorId hint from query param → validate via PK read
 * 3. Query vendors.EmailIndex by email → org owner path
 * 4. Fallback: Query rbac_members.UserOrgsIndex by userId (Cognito sub)
 *    → resolves team members who don't have their own vendor record
 *    → sets req.isTeamMember = true so downstream handlers can adapt
 *
 * @param {Object} req - Express request (needs req.auth.email + req.auth.sub)
 * @param {Object} res - Express response
 * @param {Function} next - Express next()
 */
export async function attachVendorId(req, res, next) {
  try {
    // Skip if vendorId already set by another middleware or route
    if (req.vendorId) return next();

    // Reuse vendorId from authMiddleware (authenticateUser) if present
    if (req.user?.vendorId) {
      req.vendorId = req.user.vendorId;
      return next();
    }

    // Accept vendorId hint from query param (sent by frontend VendorContext).
    // Validate with a cheap GetItem (PK read) to ensure the vendorId belongs
    // to the authenticated email. Falls through to full EmailIndex Query if
    // validation fails (forged / stale hint).
    const hintVendorId = req.query?.vendorId;
    const email = req.auth?.email;

    if (hintVendorId && email) {
      const hintResult = await docClient.send(new GetCommand({
        TableName: VENDORS_TABLE,
        Key: { vendorId: hintVendorId },
        ProjectionExpression: 'vendorId, email',
      }));

      if (hintResult.Item?.email === email) {
        req.vendorId = hintVendorId;
        return next();
      }
      // Hint didn't match — fall through to full EmailIndex lookup
      console.warn(
        `[attachVendorId] vendorId hint "${hintVendorId}" does not match authenticated email — ignoring hint`
      );
    }

    if (!email) return next();

    // Primary path: org owner has their own vendor record
    const result = await docClient.send(new QueryCommand({
      TableName: VENDORS_TABLE,
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
      ProjectionExpression: 'vendorId',
      Limit: 1,
    }));

    const vendor = result.Items?.[0];
    if (vendor?.vendorId) {
      req.vendorId = vendor.vendorId;
      return next();
    }

    // ── Fallback: team member path ──
    // Team members don't have their own vendor record. Resolve via rbac_members
    // using UserOrgsIndex (PK: userId = Cognito sub) to find their orgId.
    const userId = req.auth?.sub;
    if (userId) {
      const memberResult = await docClient.send(new QueryCommand({
        TableName: MEMBERS_TABLE,
        IndexName: 'UserOrgsIndex',
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        ProjectionExpression: 'orgId, #s',
        ExpressionAttributeNames: { '#s': 'status' },
        Limit: 5, // A user could be in multiple orgs; pick first active vendor org
      }));

      const activeMembership = memberResult.Items?.find(
        (m) => m.status === 'active' && m.orgId
      );

      if (activeMembership?.orgId) {
        req.vendorId = activeMembership.orgId;
        req.isTeamMember = true;
        console.log(`[attachVendorId] Resolved team member ${email} → orgId ${activeMembership.orgId}`);
      }
    }

    return next();
  } catch (err) {
    // Non-blocking: log and continue without vendorId
    console.warn('[attachVendorId] Failed to resolve vendorId:', err.message);
    return next();
  }
}
