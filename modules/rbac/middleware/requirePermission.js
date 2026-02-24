// ============================================================
// FILE: requirePermission.js
// PURPOSE: Route-level middleware factory that checks if the current user
//          has a specific permission. Returns 403 if not.
// CONNECTS TO: attachRBAC.js (must run before this — provides req.rbac),
//              permission.utils.js (hasPermission logic)
// ============================================================

import { hasPermission } from '../utils/permission.utils.js';

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
 * Phase 1 behavior (PERMISSIVE MODE):
 *   If req.rbac is missing (middleware not attached), logs a warning and allows.
 *   This will be tightened in Phase 4.
 *
 * @param {string} module - Module code (e.g., 'products', 'orders')
 * @param {string} action - Action verb (e.g., 'view', 'create', 'edit', 'delete')
 * @returns {Function} Express middleware
 */
export function requirePermission(module, action) {
  return (req, res, next) => {
    // Phase 1 permissive: if RBAC context not loaded, allow with warning
    if (!req.rbac) {
      console.warn(`[RBAC] requirePermission(${module}:${action}) — no RBAC context. Allowing (Phase 1 permissive mode).`);
      return next();
    }

    // Check permission using the utility (handles wildcards and manage grants)
    if (hasPermission(req.rbac.permissionSet, module, action)) {
      return next();
    }

    // Permission denied
    console.warn(
      `[RBAC] Permission denied: user=${req.rbac.userId} role=${req.rbac.roleName} ` +
      `required=${module}:${action} org=${req.rbac.orgId}`
    );

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
      console.warn('[RBAC] requireSuperAdmin — no RBAC context. Allowing (Phase 1 permissive mode).');
      return next();
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
