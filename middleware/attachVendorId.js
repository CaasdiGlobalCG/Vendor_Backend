// ============================================================
// FILE: middleware/attachVendorId.js
// PURPOSE: Resolves the vendor's orgId (vendorId) from the authenticated
//          user's email using the vendors table EmailIndex GSI.
//          Sets req.vendorId — single source of truth for all downstream
//          middleware and controllers (RBAC, workspace, leads, etc.).
// CONNECTS TO: cognitoJwtMiddleware.js (needs req.auth.email),
//              vendors table (EmailIndex GSI),
//              attachRBAC.js (consumes req.vendorId)
// ============================================================

import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const VENDORS_TABLE = process.env.VENDORS_TABLE || 'vendors';

// Reusable v3 doc client — shared across all requests
const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * Middleware: Resolve vendorId from the authenticated user's email.
 *
 * Uses the EmailIndex GSI on the vendors table (Query, not Scan).
 * Caches vendorId in req.vendorId for all downstream handlers.
 *
 * If no vendor record is found, req.vendorId remains undefined —
 * downstream middleware (like attachRBAC) handles fallback behavior.
 *
 * @param {Object} req - Express request (needs req.auth.email from cognitoJwtMiddleware)
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
    }

    return next();
  } catch (err) {
    // Non-blocking: log and continue without vendorId
    console.warn('[attachVendorId] Failed to resolve vendorId:', err.message);
    return next();
  }
}
