// ============================================================
// FILE: seedPermissions.js
// PURPOSE: Seeds the rbac_permissions table with all valid permissions
//          across all platforms (vendor, client, sales).
//          This table acts as a CATALOG / REFERENCE — not used at runtime
//          by attachRBAC. Used by: role editor UI, permission validation,
//          "My Permissions" page.
//          Safe to re-run — uses PutItem (upserts existing records).
// CONNECTS TO: modules.js (vendor + client module registries),
//              tables.js (table name constants)
// ============================================================
// USAGE: node modules/rbac/scripts/seedPermissions.js
// ============================================================

import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';
import { VENDOR_MODULES, CLIENT_MODULES } from '../config/modules.js';

// ──────────────────────────────────────
// MODULE CATEGORIES — used for UI grouping in permission matrix
// ──────────────────────────────────────

const VENDOR_CATEGORIES = {
  dashboard:       'core',
  products:        'core',
  inventory:       'core',
  enquiry:         'sales',
  quotations:      'sales',
  orders:          'sales',
  crm:             'sales',
  shipments:       'logistics',
  warranty:        'logistics',
  projects:        'operations',
  leads:           'sales',
  workspace:       'operations',
  purchase_orders: 'procurement',
  notifications:   'system',
  settings:        'system',
  user_management: 'system',
  activity_log:    'system',
};

const CLIENT_CATEGORIES = {
  dashboard:        'core',
  explore:          'core',
  projects:         'core',
  request_project:  'core',
  products_enquiry: 'procurement',
  orders:           'procurement',
  billing:          'finance',
  documents:        'operations',
  workspace:        'operations',
  quotations:       'procurement',
  chat:             'communication',
  settings:         'system',
  user_management:  'system',
  activity_log:     'system',
};

/**
 * Sales platform uses a subset of vendor modules.
 * Defined inline here (vendor backend's modules.js has VENDOR_MODULES
 * but sales uses only a subset). Matches SALES_MODULE_CONFIG from
 * Complete_B2B_With_Sales_final/sales/whiteboard-ui/src/rbac/constants/modules.js
 */
const SALES_MODULES = {
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

const SALES_CATEGORIES = {
  dashboard:       'sales',
  orders:          'sales',
  products:        'sales',
  enquiry:         'sales',
  quotations:      'sales',
  shipments:       'logistics',
  inventory:       'logistics',
  warranty:        'logistics',
  notifications:   'system',
  settings:        'system',
  user_management: 'system',
  activity_log:    'system',
};

/** Human-readable descriptions for each action */
const ACTION_DESCRIPTIONS = {
  view:   'View and list records',
  create: 'Create new records',
  edit:   'Edit existing records',
  delete: 'Delete records',
  export: 'Export data to CSV/PDF',
  manage: 'Full access — grants all actions for this module',
};

// ──────────────────────────────────────
// SEED LOGIC
// ──────────────────────────────────────

/**
 * Seed all permissions for a single platform.
 *
 * @param {string} platform - 'vendor' | 'client' | 'sales'
 * @param {Object} modules  - Module registry (key → { label, actions })
 * @param {Object} categories - Module-to-category mapping
 * @returns {Promise<number>} Count of permissions seeded
 */
async function seedPlatformPermissions(platform, modules, categories) {
  const now = new Date().toISOString();
  let count = 0;

  for (const [moduleKey, moduleDef] of Object.entries(modules)) {
    for (const action of moduleDef.actions) {
      const permissionId = `${moduleKey}:${action}`;

      try {
        await docClient.send(new PutCommand({
          TableName: TABLES.PERMISSIONS,
          Item: {
            platform,
            permissionId,
            resource: moduleKey,
            action,
            label: moduleDef.label,
            description: `${ACTION_DESCRIPTIONS[action] || action} in ${moduleDef.label}`,
            category: categories[moduleKey] || 'general',
            createdAt: now,
            updatedAt: now,
          },
        }));
        count++;
      } catch (error) {
        console.error(`  ✗ ${platform}/${permissionId}:`, error.message);
      }
    }
  }

  return count;
}

/**
 * List current permissions in the table for a platform.
 * Used for summary display after seeding.
 */
async function countPermissions(platform) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLES.PERMISSIONS,
    KeyConditionExpression: 'platform = :p',
    ExpressionAttributeValues: { ':p': platform },
    Select: 'COUNT',
  }));
  return result.Count || 0;
}

// ──────────────────────────────────────
// MAIN
// ──────────────────────────────────────

async function main() {
  console.log('=== Seed RBAC Permissions Catalog ===\n');

  // Vendor
  console.log('--- Vendor Platform ---');
  const vendorCount = await seedPlatformPermissions('vendor', VENDOR_MODULES, VENDOR_CATEGORIES);
  console.log(`  ✓ Seeded ${vendorCount} vendor permissions`);

  // Client
  console.log('\n--- Client Platform ---');
  const clientCount = await seedPlatformPermissions('client', CLIENT_MODULES, CLIENT_CATEGORIES);
  console.log(`  ✓ Seeded ${clientCount} client permissions`);

  // Sales
  console.log('\n--- Sales Platform ---');
  const salesCount = await seedPlatformPermissions('sales', SALES_MODULES, SALES_CATEGORIES);
  console.log(`  ✓ Seeded ${salesCount} sales permissions`);

  // Summary
  console.log('\n--- Final Counts ---');
  for (const p of ['vendor', 'client', 'sales']) {
    const total = await countPermissions(p);
    console.log(`  ${p}: ${total} permissions`);
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
