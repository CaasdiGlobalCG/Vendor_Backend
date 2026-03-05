// ============================================================
// FILE: rbac/controllers/auditLogController.js
// PURPOSE: API controller for querying RBAC audit logs.
//          Super Admin sees all logs. Others see own + lower-level logs.
// CONNECTS TO: rbac_audit_log table, rbac_members table, rbac_roles table,
//              rbacRoutes.js (route registration)
// ============================================================

import { QueryCommand, GetCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';

/**
 * GET /api/rbac/audit-logs
 * Returns audit log entries based on caller's access level.
 *
 * Query params:
 *   - userId (optional): filter to a specific user's logs
 *   - limit (optional): max items per page (default 50, max 100)
 *   - lastKey (optional): base64 pagination cursor
 *   - action (optional): filter by action type (e.g. ROLE_CHANGED)
 *
 * Access rules:
 *   - Super Admin: sees ALL org logs
 *   - Any member: can always see their OWN logs
 *   - Members with user_management:view: can see logs of users at lower role level
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function getAuditLogs(req, res) {
  try {
    const { orgId, userId: callerId, roleLevel: callerLevel, isSuperAdmin } = req.rbac;
    const { userId: targetUserId, limit: limitStr, lastKey, action } = req.query;

    const limit = Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 100);

    // ── Determine which logs the caller can see ──
    let logs = [];
    let paginationKey = null;

    if (targetUserId) {
      // ── Requesting a specific user's logs ──
      const canView = await canViewUserLogs(orgId, callerId, callerLevel, isSuperAdmin, targetUserId);
      if (!canView) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to view this user\'s activity logs.',
        });
      }

      // Query using UserAuditIndex for the target user's logs
      const params = {
        TableName: TABLES.AUDIT_LOG,
        IndexName: 'UserAuditIndex',
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': targetUserId },
        ScanIndexForward: false, // newest first
        Limit: limit,
      };

      if (action) {
        params.FilterExpression = '#act = :act';
        params.ExpressionAttributeNames = { '#act': 'action' };
        params.ExpressionAttributeValues[':act'] = action;
      }

      if (lastKey) {
        try { params.ExclusiveStartKey = JSON.parse(Buffer.from(lastKey, 'base64').toString()); }
        catch { /* ignore invalid cursor */ }
      }

      const result = await docClient.send(new QueryCommand(params));
      logs = result.Items || [];
      paginationKey = result.LastEvaluatedKey;

    } else if (isSuperAdmin) {
      // ── Super Admin: query all org logs ──
      const params = {
        TableName: TABLES.AUDIT_LOG,
        KeyConditionExpression: 'orgId = :oid',
        ExpressionAttributeValues: { ':oid': orgId },
        ScanIndexForward: false,
        Limit: limit,
      };

      if (action) {
        params.FilterExpression = '#act = :act';
        params.ExpressionAttributeNames = { '#act': 'action' };
        params.ExpressionAttributeValues[':act'] = action;
      }

      if (lastKey) {
        try { params.ExclusiveStartKey = JSON.parse(Buffer.from(lastKey, 'base64').toString()); }
        catch { /* ignore invalid cursor */ }
      }

      const result = await docClient.send(new QueryCommand(params));
      logs = result.Items || [];
      paginationKey = result.LastEvaluatedKey;

    } else {
      // ── Regular member: own logs only (unless they specify userId) ──
      const params = {
        TableName: TABLES.AUDIT_LOG,
        IndexName: 'UserAuditIndex',
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': callerId },
        ScanIndexForward: false,
        Limit: limit,
      };

      if (action) {
        params.FilterExpression = '#act = :act';
        params.ExpressionAttributeNames = { '#act': 'action' };
        params.ExpressionAttributeValues[':act'] = action;
      }

      if (lastKey) {
        try { params.ExclusiveStartKey = JSON.parse(Buffer.from(lastKey, 'base64').toString()); }
        catch { /* ignore invalid cursor */ }
      }

      const result = await docClient.send(new QueryCommand(params));
      logs = result.Items || [];
      paginationKey = result.LastEvaluatedKey;
    }

    // ── Enrich logs with actor email / display name ──
    // Logs written after this fix already carry actorEmail; only look up missing ones
    const idsNeedingLookup = [...new Set(
      logs.filter((l) => !l.actorEmail && l.userId).map((l) => l.userId)
    )];
    const userMap = {};
    if (idsNeedingLookup.length > 0) {
      // BatchGet max 100 keys per call
      for (let i = 0; i < idsNeedingLookup.length; i += 100) {
        const keys = idsNeedingLookup.slice(i, i + 100).map((uid) => ({ orgId, userId: uid }));
        try {
          const batch = await docClient.send(new BatchGetCommand({
            RequestItems: {
              [TABLES.MEMBERS]: {
                Keys: keys,
                ProjectionExpression: 'userId, email, displayName',
              },
            },
          }));
          for (const item of (batch.Responses?.[TABLES.MEMBERS] || [])) {
            userMap[item.userId] = { email: item.email, name: item.displayName };
          }
        } catch (batchErr) {
          console.error('[RBAC] batch user lookup error:', batchErr?.message);
        }
      }

      // Fallback: resolve current caller's email from JWT auth context
      // (handles org owners who have no rbac_members record yet)
      const authSub = req.auth?.sub;
      const authEmail = req.auth?.email;
      if (authSub && authEmail && !userMap[authSub]) {
        userMap[authSub] = { email: authEmail, name: req.auth?.name || null };
      }

      for (const log of logs) {
        if (!log.actorEmail) {
          const u = userMap[log.userId];
          if (u) { log.actorEmail = u.email; log.actorName = u.name; }
        }
      }
    }

    // ── Response ──
    return res.status(200).json({
      logs,
      total: logs.length,
      lastKey: paginationKey
        ? Buffer.from(JSON.stringify(paginationKey)).toString('base64')
        : null,
      hasMore: !!paginationKey,
    });
  } catch (error) {
    console.error('[RBAC] getAuditLogs error:', error);
    return res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
}

/**
 * Check if caller can view a target user's audit logs.
 * Rules:
 *   1. Can always view own logs
 *   2. Super Admin can view anyone's logs
 *   3. Can view if callerLevel < targetLevel (hierarchy)
 *
 * @param {string} orgId
 * @param {string} callerId
 * @param {number} callerLevel
 * @param {boolean} isSuperAdmin
 * @param {string} targetUserId
 * @returns {Promise<boolean>}
 */
async function canViewUserLogs(orgId, callerId, callerLevel, isSuperAdmin, targetUserId) {
  // Own logs — always allowed
  if (targetUserId === callerId) return true;

  // Super Admin — always allowed
  if (isSuperAdmin) return true;

  // Fetch target member's role level
  try {
    const memberResult = await docClient.send(new GetCommand({
      TableName: TABLES.MEMBERS,
      Key: { orgId, userId: targetUserId },
      ProjectionExpression: 'roleId',
    }));

    if (!memberResult.Item) return false;

    const roleResult = await docClient.send(new GetCommand({
      TableName: TABLES.ROLES,
      Key: { orgId, roleId: memberResult.Item.roleId },
      ProjectionExpression: 'roleLevel',
    }));

    const targetLevel = roleResult.Item?.roleLevel ?? 999;
    return callerLevel < targetLevel;
  } catch {
    return false;
  }
}
