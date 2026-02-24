// ============================================================
// FILE: permission.utils.js
// PURPOSE: Pure helper functions for permission checking.
//          No side effects, no DB calls — just logic.
// CONNECTS TO: attachRBAC.js (uses hasPermission), requirePermission.js,
//              frontend useRBAC hook (same logic can be shared)
// ============================================================

/**
 * Check if a permission set grants access to a specific module:action.
 * Handles the wildcard (*:*) and module-level manage (module:manage) grants.
 *
 * @param {Set<string>|string[]} permissions - The user's permission set
 * @param {string} module - Module code (e.g., 'products')
 * @param {string} action - Action verb (e.g., 'create')
 * @returns {boolean} true if access is granted
 */
export function hasPermission(permissions, module, action) {
  // Convert array to Set for O(1) lookups if needed
  const permSet = permissions instanceof Set ? permissions : new Set(permissions);

  // Wildcard — Super Admin
  if (permSet.has('*:*')) return true;

  // Module-level manage grants all actions on that module
  if (permSet.has(`${module}:manage`)) return true;

  // Exact permission match
  return permSet.has(`${module}:${action}`);
}

/**
 * Check if the user is a Super Admin (has wildcard permission).
 *
 * @param {Set<string>|string[]} permissions - The user's permission set
 * @returns {boolean}
 */
export function isSuperAdmin(permissions) {
  const permSet = permissions instanceof Set ? permissions : new Set(permissions);
  return permSet.has('*:*');
}

/**
 * Check if a caller can manage a target based on role levels.
 * A user can only manage users at a LOWER authority (HIGHER level number).
 *
 * @param {number} callerLevel - Role level of the person performing the action
 * @param {number} targetLevel - Role level of the person being managed
 * @returns {boolean} true if caller has authority over target
 */
export function canManageUser(callerLevel, targetLevel) {
  return callerLevel < targetLevel;
}

/**
 * Extract unique module codes from a permissions array.
 * Useful for building the sidebar — only show modules the user has ANY access to.
 *
 * @param {string[]} permissions - Array of permission strings
 * @returns {string[]} Unique module codes the user can access
 */
export function getAccessibleModules(permissions) {
  const modules = new Set();
  for (const perm of permissions) {
    if (perm === '*:*') return ['*']; // Super Admin — all modules
    const [mod] = perm.split(':');
    modules.add(mod);
  }
  return Array.from(modules);
}

/**
 * Build a permission map grouped by module.
 * Useful for rendering the permission grid in the UI.
 *
 * @param {string[]} permissions - Array of permission strings
 * @returns {Object.<string, string[]>} Map of module → actions
 * @example
 *   buildPermissionMap(['products:view', 'products:create', 'orders:view'])
 *   // → { products: ['view', 'create'], orders: ['view'] }
 */
export function buildPermissionMap(permissions) {
  const map = {};
  for (const perm of permissions) {
    if (perm === '*:*') continue; // Skip wildcard — handled separately
    const [mod, action] = perm.split(':');
    if (!map[mod]) map[mod] = [];
    map[mod].push(action);
  }
  return map;
}
