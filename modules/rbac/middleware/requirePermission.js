// ============================================================
// FILE: requirePermission.js
// PURPOSE: Route-level middleware factory that checks if the current user
//          has a specific permission. Returns 403 if not.
// CONNECTS TO: attachRBAC.js (must run before this — provides req.rbac),
//              permission.utils.js (hasPermission logic)
// ============================================================

import { hasPermission } from '../utils/permission.utils.js';
import { logSecurityEvent, SECURITY_ACTIONS } from '../../logging/services/securityLogger.js';

/** Helper to build metadata for security logs */
function buildMeta(req) {
  return { ip: req.ip || req.connection?.remoteAddress, userAgent: req.get('user-agent'), requestId: req.requestId };
}

/**
 * Creates a middleware that checks for a specific module:action permission.
 *
 * Usage in routes:
 *   router.get('/products', requirePermission('products', 'view'), controller.list);
 *   router.post('/products', requirePermission('products', 'create'), controller.create);
 *
 * Permission resolution order:
 *   1. '*:*' → allow (Super Admin wildcard)
 *   2. 'module:manage' → allow (module-level manage grants all actions)
 *   3. 'module:action' → allow (exact match)
 *   4. Otherwise → 403
 *
 * Enforcement behavior:
 *   If req.rbac is missing, block with 403.
 *
 * @param {string} module - Module code (e.g., 'products', 'orders')
 * @param {string} action - Action verb (e.g., 'view', 'create', 'edit', 'delete')
 * @returns {Function} Express middleware
 */
export function requirePermission(module, action) {
  return (req, res, next) => {
    // No RBAC context
    if (!req.rbac) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'RBAC_003',
        message: 'Access denied — no RBAC context.',
        required: `${module}:${action}`,
      });
    }

    // Check permission using the utility (handles wildcards and manage grants)
    if (hasPermission(req.rbac.permissionSet, module, action)) {
      return next();
    }

    // Permission denied — log to security_log table (fire-and-forget)
    logSecurityEvent({
      orgId: req.rbac.orgId,
      action: SECURITY_ACTIONS.PERMISSION_DENIED,
      actorId: req.rbac.userId,
      actorEmail: req.auth?.email || '',
      details: {
        attemptedRoute: `${req.method} ${req.originalUrl}`,
        requiredPermission: `${module}:${action}`,
        roleName: req.rbac.roleName,
      },
      metadata: buildMeta(req),
    });

    return res.status(403).json({
      error: 'Forbidden',
      code: 'RBAC_003',
      message: 'You do not have permission to perform this action.',
      required: `${module}:${action}`,
    });
  };
}

/**
 * Middleware that requires the user to be a Super Admin.
 * Used for sensitive operations like transferring ownership or plan upgrades.
 *
 * @returns {Function} Express middleware
 */
export function requireSuperAdmin() {
  return (req, res, next) => {
    if (!req.rbac) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'RBAC_003',
        message: 'Access denied — no RBAC context.',
      });
    }

    if (req.rbac.isSuperAdmin) {
      return next();
    }

    return res.status(403).json({
      error: 'Forbidden',
      code: 'RBAC_003',
      message: 'Only the Super Admin can perform this action.',
    });
  };
}
