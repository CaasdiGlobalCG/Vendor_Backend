// ============================================================
// FILE: tables.js
// PURPOSE: Single source of truth for all RBAC DynamoDB table names.
//          Change table names here — every script / middleware picks them up.
// CONNECTS TO: Every RBAC file that reads or writes DynamoDB
// ============================================================

/**
 * RBAC table names.
 * Override via environment variables for per-environment naming (e.g., staging vs production).
 */
export const TABLES = {
  ORGANIZATIONS:      process.env.RBAC_ORGANIZATIONS_TABLE      || 'rbac_organizations',
  ROLES:              process.env.RBAC_ROLES_TABLE               || 'rbac_roles',
  MEMBERS:            process.env.RBAC_MEMBERS_TABLE             || 'rbac_members',
  PERMISSIONS:        process.env.RBAC_PERMISSIONS_TABLE         || 'rbac_permissions',
  INVITATIONS:        process.env.RBAC_INVITATIONS_TABLE         || 'rbac_invitations',
  AUDIT_LOG:          process.env.RBAC_AUDIT_LOG_TABLE           || 'rbac_audit_log',
  SUBSCRIPTION_PLANS: process.env.RBAC_SUBSCRIPTION_PLANS_TABLE  || 'rbac_subscription_plans',
};

/**
 * Existing tables that RBAC reads from during backfill / lazy migration.
 */
export const EXISTING_TABLES = {
  USERS:   process.env.USERS_TABLE   || 'users',
  VENDORS: process.env.VENDORS_TABLE || 'vendors',
  CLIENTS: process.env.CLIENTS_TABLE || 'clients',
};
