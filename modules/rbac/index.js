// ============================================================
// FILE: index.js (RBAC module barrel export)
// PURPOSE: Single entry point for the RBAC module.
//          Follows the existing barrel-export pattern used by
//          vendor/, workspace/, and pm/ modules.
// CONNECTS TO: server.js (imports this to mount RBAC routes + middleware)
// ============================================================

// Routes
export { default as rbacRoutes } from './routes/rbacRoutes.js';
export { default as invitePublicRoutes } from './routes/invitePublicRoutes.js';

// Middleware — exported for use on other module routes
export { attachRBAC } from './middleware/attachRBAC.js';
export { requirePermission, requireSuperAdmin } from './middleware/requirePermission.js';

// Config — exported so other modules can reference module/role definitions
export { VENDOR_MODULES, CLIENT_MODULES, getAllPermissions, getModuleKeys } from './config/modules.js';
export { ROLE_LEVELS, VENDOR_DEFAULT_ROLES, CLIENT_DEFAULT_ROLES } from './config/roles.js';
export { TABLES } from './config/tables.js';

// Utils — exported for use in controllers that need permission checks
export { hasPermission, isSuperAdmin, canManageUser, buildPermissionMap } from './utils/permission.utils.js';

// Services — exported for module bootstrap hooks
export { initializeSuspensionScheduler } from './services/suspensionScheduler.js';
