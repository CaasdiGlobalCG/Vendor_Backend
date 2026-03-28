// ============================================================
// FILE: meController.js
// PURPOSE: Handles GET /api/rbac/me — returns the current user's RBAC
//          context (role, permissions, org info). Used by the frontend
//          to build dynamic navigation and permission checks.
// CONNECTS TO: attachRBAC middleware (provides req.rbac),
//              modules.js (returns module registry for frontend grid),
//              roles.js (returns role level info)
// ============================================================

import { VENDOR_MODULES, CLIENT_MODULES, getModuleKeys } from '../config/modules.js';
import { ROLE_LEVELS } from '../config/roles.js';
import { buildPermissionMap, getAccessibleModules } from '../utils/permission.utils.js';

/**
 * GET /api/rbac/me
 *
 * Returns the fully resolved RBAC context for the authenticated user.
 * Frontend uses this to:
 * - Show/hide sidebar modules
 * - Enable/disable action buttons
 * - Display the user's role name
 *
 * @param {Object} req - Express request (req.rbac set by attachRBAC middleware)
 * @param {Object} res - Express response
 */
export async function getMyRBAC(req, res) {
  try {
    const rbac = req.rbac;

    // No RBAC context — user has no org association
    if (!rbac) {
      return res.status(200).json({
        hasRBAC: false,
        message: 'No organization membership found.',
      });
    }

    // Pick the correct module registry based on org type
    const modules = rbac.orgType === 'client' ? CLIENT_MODULES : VENDOR_MODULES;
    const moduleKeys = getModuleKeys(modules);

    // Build a structured permission map for the frontend
    // e.g., { products: ['view', 'create', 'edit'], orders: ['view'] }
    const permissionMap = buildPermissionMap(rbac.permissions);

    // Get list of modules the user can access (has at least one permission)
    const accessibleModules = getAccessibleModules(rbac.permissionSet);

    return res.status(200).json({
      hasRBAC: true,
      userId: rbac.userId,
      orgId: rbac.orgId,
      orgType: rbac.orgType,
      role: {
        roleId: rbac.roleId,
        roleName: rbac.roleName,
        roleLevel: rbac.roleLevel,
        isSuperAdmin: rbac.isSuperAdmin,
      },
      permissions: rbac.permissions,
      permissionMap,
      accessibleModules,
      allModules: moduleKeys,
      roleLevels: ROLE_LEVELS,
      // platformAccess: which platforms this user can switch to
      platformAccess: rbac.platformAccess || [rbac.orgType],
      accessScopes: rbac.accessScopes || {
        projectIds: ['*'],
        workspaceIds: ['*'],
        allowAllProjects: true,
        allowAllWorkspaces: true,
      },
      // Phase 1 flag — tells frontend this is a fallback grant
      _fallback: rbac._fallback || false,
    });
  } catch (error) {
    console.error('[RBAC] Error in getMyRBAC:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to load RBAC context.',
    });
  }
}
