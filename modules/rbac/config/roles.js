// ============================================================
// FILE: roles.js
// PURPOSE: Default role definitions with their permission sets.
//          When a new module is added to modules.js, add its default
//          permissions here for each role.
// CONNECTS TO: modules.js (module codes), seedDefaults.js (seeds these into DynamoDB)
// ============================================================

/**
 * Role levels — lower number = higher authority.
 * Used for hierarchy enforcement (can only manage roles with HIGHER level number).
 */
export const ROLE_LEVELS = {
  SUPER_ADMIN: 0,
  ADMIN:       1,
  MANAGER:     2,
  MEMBER:      3,
  VIEWER:      4,
};

/**
 * Vendor‑side default roles.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  HOW TO UPDATE WHEN A NEW MODULE IS ADDED:                       │
 * │  1. Add the module's permissions to each role below              │
 * │  2. Super Admin always gets '*:*' — no change needed there       │
 * │  3. For other roles, decide which actions they get               │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * @type {Array<{roleId: string, roleName: string, roleLevel: number, isSystem: boolean, description: string, permissions: string[]}>}
 */
export const VENDOR_DEFAULT_ROLES = [
  {
    roleId: 'super_admin',
    roleName: 'Super Admin',
    roleLevel: ROLE_LEVELS.SUPER_ADMIN,
    isSystem: true,
    description: 'Account owner with unrestricted access.',
    // Wildcard — automatically grants every permission on every module
    permissions: ['*:*'],
  },
  {
    roleId: 'admin',
    roleName: 'Admin',
    roleLevel: ROLE_LEVELS.ADMIN,
    isSystem: true,
    description: 'Delegated administrator with near-full access.',
    permissions: [
      'dashboard:manage',
      'products:manage',
      'inventory:manage',
      'enquiry:manage',
      'quotations:manage',
      'orders:manage',
      'crm:manage',
      'shipments:manage',
      'warranty:manage',
      'projects:manage',
      'leads:manage',
      'workspace:manage',
      'purchase_orders:manage',
      'notifications:manage',
      'settings:view', 'settings:edit',
      'user_management:manage',
      'activity_log:view', 'activity_log:export',
    ],
  },
  {
    roleId: 'sales_admin',
    roleName: 'Sales Admin',
    roleLevel: ROLE_LEVELS.ADMIN,
    isSystem: true,
    description: 'Full access to all sales modules. Can manage sales team members.',
    permissions: [
      // Sales modules — full access
      'dashboard:manage',
      'products:manage',
      'inventory:manage',
      'enquiry:manage',
      'quotations:manage',
      'orders:manage',
      'crm:manage',
      'shipments:manage',
      'warranty:manage',
      'purchase_orders:manage',
      'notifications:manage',
      // Team management within sales
      'user_management:manage',
      // Settings — view only
      'settings:view',
      'activity_log:view', 'activity_log:export',
    ],
  },
  {
    roleId: 'manager',
    roleName: 'Manager',
    roleLevel: ROLE_LEVELS.MANAGER,
    isSystem: true,
    description: 'Department or team lead for day-to-day operations.',
    permissions: [
      'dashboard:view', 'dashboard:export',
      'products:view', 'products:create', 'products:edit',
      'inventory:view', 'inventory:create', 'inventory:edit',
      'enquiry:view', 'enquiry:create', 'enquiry:edit',
      'quotations:view', 'quotations:create', 'quotations:edit',
      'orders:view', 'orders:create', 'orders:edit', 'orders:export',
      'crm:view', 'crm:create', 'crm:edit',
      'shipments:view', 'shipments:create', 'shipments:edit',
      'warranty:view', 'warranty:create', 'warranty:edit',
      'projects:view', 'projects:create', 'projects:edit',
      'leads:view', 'leads:create', 'leads:edit',
      'workspace:view', 'workspace:create', 'workspace:edit',
      'purchase_orders:view', 'purchase_orders:create', 'purchase_orders:edit',
      'notifications:view', 'notifications:edit',
      'settings:view',
    ],
  },
  {
    roleId: 'member',
    roleName: 'Member',
    roleLevel: ROLE_LEVELS.MEMBER,
    isSystem: true,
    description: 'Standard team member with create access to key modules.',
    permissions: [
      'dashboard:view',
      'products:view', 'products:create',
      'inventory:view',
      'enquiry:view', 'enquiry:create',
      'quotations:view',
      'orders:view', 'orders:create',
      'crm:view',
      'shipments:view',
      'warranty:view',
      'projects:view',
      'leads:view', 'leads:create',
      'workspace:view',
      'purchase_orders:view',
      'notifications:view',
    ],
  },
  {
    roleId: 'viewer',
    roleName: 'Viewer',
    roleLevel: ROLE_LEVELS.VIEWER,
    isSystem: true,
    description: 'Read-only access across all modules.',
    permissions: [
      'dashboard:view',
      'products:view',
      'inventory:view',
      'enquiry:view',
      'quotations:view',
      'orders:view',
      'crm:view',
      'shipments:view',
      'warranty:view',
      'projects:view',
      'leads:view',
      'workspace:view',
      'purchase_orders:view',
      'notifications:view',
    ],
  },
];

/**
 * Client‑side default roles.
 */
export const CLIENT_DEFAULT_ROLES = [
  {
    roleId: 'super_admin',
    roleName: 'Super Admin',
    roleLevel: ROLE_LEVELS.SUPER_ADMIN,
    isSystem: true,
    description: 'Account owner with unrestricted access.',
    permissions: ['*:*'],
  },
  {
    roleId: 'admin',
    roleName: 'Admin',
    roleLevel: ROLE_LEVELS.ADMIN,
    isSystem: true,
    description: 'Delegated administrator.',
    permissions: [
      'dashboard:manage',
      'explore:manage',
      'projects:manage',
      'request_project:manage',
      'products_enquiry:manage',
      'orders:manage',
      'billing:view', 'billing:edit', 'billing:export',
      'documents:manage',
      'workspace:manage',
      'quotations:manage',
      'chat:manage',
      'settings:view', 'settings:edit',
      'user_management:view', 'user_management:create', 'user_management:edit',
      'activity_log:view', 'activity_log:export',
    ],
  },
  {
    roleId: 'procurement_manager',
    roleName: 'Procurement Manager',
    roleLevel: ROLE_LEVELS.MANAGER,
    isSystem: true,
    description: 'Handles purchasing, quotations, and orders.',
    permissions: [
      'dashboard:view',
      'explore:view', 'explore:create',
      'projects:view', 'projects:create', 'projects:edit',
      'request_project:view', 'request_project:create', 'request_project:edit',
      'products_enquiry:view', 'products_enquiry:create', 'products_enquiry:edit',
      'orders:view', 'orders:create', 'orders:edit', 'orders:export',
      'billing:view',
      'documents:view', 'documents:create', 'documents:edit',
      'workspace:view', 'workspace:create', 'workspace:edit',
      'quotations:view', 'quotations:create', 'quotations:edit',
      'chat:view', 'chat:create',
      'settings:view',
    ],
  },
  {
    roleId: 'member',
    roleName: 'Member',
    roleLevel: ROLE_LEVELS.MEMBER,
    isSystem: true,
    description: 'Standard team member.',
    permissions: [
      'dashboard:view',
      'explore:view',
      'projects:view',
      'request_project:view', 'request_project:create',
      'products_enquiry:view', 'products_enquiry:create',
      'orders:view',
      'documents:view',
      'workspace:view',
      'quotations:view',
      'chat:view', 'chat:create',
    ],
  },
  {
    roleId: 'viewer',
    roleName: 'Viewer',
    roleLevel: ROLE_LEVELS.VIEWER,
    isSystem: true,
    description: 'Read-only access.',
    permissions: [
      'dashboard:view',
      'explore:view',
      'projects:view',
      'request_project:view',
      'products_enquiry:view',
      'orders:view',
      'documents:view',
      'workspace:view',
      'quotations:view',
      'chat:view',
    ],
  },
];
