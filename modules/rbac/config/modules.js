// ============================================================
// FILE: modules.js
// PURPOSE: Central registry of ALL vendor-side modules and their permitted actions.
//          THIS IS THE SINGLE FILE TO EDIT WHEN ADDING A NEW MODULE.
// CONNECTS TO: roles.js (references module keys for default permissions),
//              requirePermission middleware (validates against these definitions)
// ============================================================

/**
 * Standard actions available to most modules.
 * Reuse this array to keep module definitions DRY.
 * 'manage' is the wildcard — grants all actions for that module.
 */
const FULL_CRUD = ['view', 'create', 'edit', 'delete', 'export', 'manage'];

/**
 * Vendor-side module registry.
 *
 * Each key is the module code used in permission strings (e.g., 'products:create').
 * - label:   Human-readable name (used in UI permission grids)
 * - actions: Array of allowed action verbs for this module
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  HOW TO ADD A NEW MODULE:                                        │
 * │  1. Add an entry below (key = module code, label + actions)      │
 * │  2. Add default permissions for each role in roles.js            │
 * │  3. Done — middleware and UI auto‑detect the new module          │
 * └──────────────────────────────────────────────────────────────────┘
 */
export const VENDOR_MODULES = {
  dashboard:       { label: 'Dashboard',         actions: ['view', 'export', 'manage'] },
  products:        { label: 'Products',          actions: FULL_CRUD },
  inventory:       { label: 'Inventory',         actions: FULL_CRUD },
  enquiry:         { label: 'Enquiry / RFQ',     actions: FULL_CRUD },
  quotations:      { label: 'Quotations',        actions: FULL_CRUD },
  orders:          { label: 'Orders / Sales',    actions: FULL_CRUD },
  crm:             { label: 'CRM',               actions: FULL_CRUD },
  shipments:       { label: 'Shipments',         actions: FULL_CRUD },
  warranty:        { label: 'Warranty',           actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  projects:        { label: 'Projects',          actions: FULL_CRUD },
  leads:           { label: 'Leads',             actions: FULL_CRUD },
  workspace:       { label: 'Workspace',         actions: FULL_CRUD },
  purchase_orders: { label: 'Purchase Orders',   actions: FULL_CRUD },
  notifications:   { label: 'Notifications',     actions: ['view', 'edit', 'delete', 'manage'] },
  settings:        { label: 'Settings',          actions: ['view', 'edit', 'manage'] },
  user_management: { label: 'User Management',   actions: FULL_CRUD },
  activity_log:    { label: 'Activity Log',      actions: ['view', 'export', 'manage'] },
};

/**
 * Client-side module registry.
 * Same structure as vendor — kept here so both sides can be managed from one place.
 * If you ever split client into a separate package, move this to that package's own modules.js.
 */
export const CLIENT_MODULES = {
  dashboard:        { label: 'Dashboard',          actions: ['view', 'manage'] },
  explore:          { label: 'Explore / Ideas',    actions: FULL_CRUD },
  projects:         { label: 'Projects',           actions: FULL_CRUD },
  request_project:  { label: 'Request Project',    actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  products_enquiry: { label: 'Products Enquiry',   actions: FULL_CRUD },
  orders:           { label: 'Orders',             actions: FULL_CRUD },
  billing:          { label: 'Billing',            actions: ['view', 'edit', 'export', 'manage'] },
  documents:        { label: 'Documents / Reports', actions: FULL_CRUD },
  workspace:        { label: 'Workspace',          actions: FULL_CRUD },
  quotations:       { label: 'Quotations',         actions: FULL_CRUD },
  chat:             { label: 'Chat',               actions: ['view', 'create', 'manage'] },
  settings:         { label: 'Settings',           actions: ['view', 'edit', 'manage'] },
  user_management:  { label: 'User Management',    actions: FULL_CRUD },
  activity_log:     { label: 'Activity Log',       actions: ['view', 'export', 'manage'] },
};

/**
 * Generate all possible permission strings for a module registry.
 * Useful for validation — ensures a permission string is real before storing it.
 *
 * @param {Object} modules - Module registry (VENDOR_MODULES or CLIENT_MODULES)
 * @returns {Set<string>} Set of all valid permission strings (e.g., 'products:create')
 */
export function getAllPermissions(modules) {
  const perms = new Set();
  for (const [moduleKey, moduleDef] of Object.entries(modules)) {
    for (const action of moduleDef.actions) {
      perms.add(`${moduleKey}:${action}`);
    }
  }
  return perms;
}

/**
 * Get all module keys from a registry.
 * Used by the frontend to build the permission grid dynamically.
 *
 * @param {Object} modules - Module registry
 * @returns {string[]} Array of module codes
 */
export function getModuleKeys(modules) {
  return Object.keys(modules);
}

/**
 * Sales-side module registry.
 * Mirrors SALES_MODULE_CONFIG from the sales whiteboard-ui frontend.
 */
export const SALES_MODULES = {
  dashboard:       { label: 'Dashboard',        actions: ['view', 'export', 'manage'] },
  orders:          { label: 'Orders & Sales',   actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  products:        { label: 'Products',         actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  enquiry:         { label: 'Enquiry / RFQ',    actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  quotations:      { label: 'Quotations',       actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  shipments:       { label: 'Shipments',        actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  inventory:       { label: 'Inventory',        actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  warranty:        { label: 'Warranty',         actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  notifications:   { label: 'Notifications',    actions: ['view', 'edit', 'delete', 'manage'] },
  settings:        { label: 'Settings',         actions: ['view', 'edit', 'manage'] },
  user_management: { label: 'User Management',  actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  activity_log:    { label: 'Activity Log',     actions: ['view', 'export', 'manage'] },
};

/**
 * Derive platformAccess from a user's permissions array.
 * Instead of storing manual platform toggles, we check which modules
 * the user has permissions for and map them to platforms.
 *
 * WHY: Platform access is scoped by the org that invited the member.
 *      - Vendor org invite → 'vendor' (always) + 'sales' (if sales-module perms exist)
 *      - Client org invite → 'client' only
 *      - Super Admin (*:*) → all 3 platforms regardless of org
 *      Cross-platform access (e.g., vendor member accessing client) only happens
 *      for Super Admins or when separately invited from the other platform.
 *
 * @param {string[]} permissions - Array of 'module:action' strings
 * @param {string}   [orgType]   - 'vendor' or 'client' — determines which platforms are reachable
 * @returns {string[]} Array of platform strings: ['vendor', 'client', 'sales']
 */
export function derivePlatformAccess(permissions, orgType) {
  if (!Array.isArray(permissions) || permissions.length === 0) {
    // Default fallback based on org type
    return orgType === 'client' ? ['client'] : ['vendor'];
  }
  // Super admin gets all platforms regardless of org type
  if (permissions.includes('*:*')) return ['vendor', 'client', 'sales'];

  // ── Org-type-aware derivation ──
  // Vendor members can access vendor + sales (if they have sales-module perms).
  // Client members can only access client.
  // This prevents shared module codes (dashboard, orders, etc.) from leaking
  // cross-platform access that was never intended.
  if (orgType === 'vendor') {
    const salesModuleKeys = new Set(Object.keys(SALES_MODULES));
    const platforms = new Set(['vendor']); // Always includes vendor
    for (const perm of permissions) {
      const moduleCode = perm.split(':')[0];
      if (moduleCode && salesModuleKeys.has(moduleCode)) {
        platforms.add('sales');
        break; // One match is enough
      }
    }
    return [...platforms];
  }

  if (orgType === 'client') {
    // Client org members only get client platform access
    return ['client'];
  }

  // ── No orgType provided (backward compat / edge case) ──
  // Fall back to the old behavior that checks all registries.
  const vendorModuleKeys = new Set(Object.keys(VENDOR_MODULES));
  const clientModuleKeys = new Set(Object.keys(CLIENT_MODULES));
  const salesModuleKeys  = new Set(Object.keys(SALES_MODULES));

  const platforms = new Set();

  for (const perm of permissions) {
    const moduleCode = perm.split(':')[0];
    if (!moduleCode) continue;
    if (vendorModuleKeys.has(moduleCode)) platforms.add('vendor');
    if (clientModuleKeys.has(moduleCode)) platforms.add('client');
    if (salesModuleKeys.has(moduleCode))  platforms.add('sales');
  }

  // Always include at least 'vendor' for backward compat
  if (platforms.size === 0) platforms.add('vendor');
  return [...platforms];
}
