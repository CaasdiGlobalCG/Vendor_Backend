// ============================================================
// FILE: utils/externalSession.js
// PURPOSE: Session tokens for non-Cognito users (PM / CAS employees)
//          who open a workspace in this app via a one-time handoff code
//          issued by the Employee backend. Tokens are HS256, vendor-signed,
//          and scoped to the workspaces the user owns or collaborates on.
// CONNECTS TO: routes/handoffRoutes.js (external-exchange),
//              middleware/cognitoJwtMiddleware.js, middleware/authMiddleware.js,
//              modules/rbac/middleware/attachRBAC.js
// ============================================================

import jwt from 'jsonwebtoken';

// Prefer a dedicated secret; fall back to the legacy PM JWT secret so existing
// deployments keep working. Set EXTERNAL_SESSION_SECRET in production.
const EXTERNAL_SESSION_SECRET =
  process.env.EXTERNAL_SESSION_SECRET ||
  process.env.JWT_SECRET ||
  'pm_dashboard_secret_key_2024';

const EXTERNAL_SESSION_TTL = '8h'; // matches sessionStore idle TTL

/**
 * Sign an external session token (HS256, no kid — distinguishes it from
 * Cognito RS256 tokens which always carry a kid header).
 */
export function signExternalSessionToken({ role, userId, email, name, workspaceIds = [], projectIds = [] }) {
  return jwt.sign(
    {
      kind: 'external',
      role,
      userId,
      email: email || null,
      name: name || null,
      workspaceIds,
      projectIds,
    },
    EXTERNAL_SESSION_SECRET,
    { expiresIn: EXTERNAL_SESSION_TTL }
  );
}

/**
 * Verify an external session token. Returns the payload or null.
 */
export function verifyExternalSessionToken(token) {
  try {
    const payload = jwt.verify(token, EXTERNAL_SESSION_SECRET);
    if (payload?.kind !== 'external' || !payload?.userId || !payload?.role) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Module permissions granted to external sessions (server-side enforcement). */
const EXTERNAL_PERMISSIONS = {
  pm: ['workspace:manage'],
  cas: ['workspace:view', 'workspace:edit'],
};

/**
 * Build a synthetic req.rbac context for an external session so the existing
 * requirePermission / canAccessWorkspace checks work unchanged. Access is
 * scoped to the workspace/project IDs embedded in the token at exchange time.
 */
export function buildExternalRbac(payload) {
  const permissions = EXTERNAL_PERMISSIONS[payload.role] || ['workspace:view'];
  return {
    orgId: 'external',
    orgType: 'external',
    userId: payload.userId,
    roleId: `external_${payload.role}`,
    roleName: payload.role === 'pm' ? 'Project Manager' : 'CAS Member',
    roleLevel: 1,
    permissions,
    permissionSet: new Set(permissions),
    isSuperAdmin: false,
    permissionOverrides: null,
    platformAccess: ['vendor'],
    accessScopes: {
      projectIds: Array.isArray(payload.projectIds) ? payload.projectIds : [],
      workspaceIds: Array.isArray(payload.workspaceIds) ? payload.workspaceIds : [],
      allowAllProjects: false,
      allowAllWorkspaces: false,
    },
    _fallback: false,
    external: true,
  };
}
