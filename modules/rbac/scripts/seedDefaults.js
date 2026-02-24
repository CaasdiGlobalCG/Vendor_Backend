// ============================================================
// FILE: seedDefaults.js
// PURPOSE: Seeds default roles and subscription plans into DynamoDB.
//          Safe to re-run — uses PutItem with condition to skip existing records.
// CONNECTS TO: roles.js (default role definitions), plans.js (plan definitions),
//              tables.js (table names)
// ============================================================
// USAGE: node modules/rbac/scripts/seedDefaults.js
// ============================================================

import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';
import { VENDOR_DEFAULT_ROLES, CLIENT_DEFAULT_ROLES } from '../config/roles.js';
import { PLANS } from '../config/plans.js';

// ──────────────────────────────────────
// SEED SUBSCRIPTION PLANS
// ──────────────────────────────────────

/**
 * Seed all subscription plans into rbac_subscription_plans table.
 */
async function seedPlans() {
  console.log('\n--- Seeding Subscription Plans ---');

  for (const plan of PLANS) {
    try {
      await docClient.send(new PutCommand({
        TableName: TABLES.SUBSCRIPTION_PLANS,
        Item: {
          planId: plan.planId,
          planName: plan.planName,
          maxSeats: plan.maxSeats,
          price: plan.price,
          features: plan.features,
          updatedAt: new Date().toISOString(),
        },
      }));
      console.log(`  ✓ Plan: ${plan.planName} (max ${plan.maxSeats} seats)`);
    } catch (error) {
      console.error(`  ✗ Plan ${plan.planId}:`, error.message);
    }
  }
}

// ──────────────────────────────────────
// SEED DEFAULT ROLES (for a specific org)
// ──────────────────────────────────────

/**
 * Seed default roles for a given organization.
 * Called during org creation or backfill.
 *
 * @param {string} orgId - The organization ID (vendorId or clientId)
 * @param {'vendor'|'client'} orgType - Which set of default roles to use
 * @returns {Promise<void>}
 */
export async function seedRolesForOrg(orgId, orgType) {
  const roles = orgType === 'vendor' ? VENDOR_DEFAULT_ROLES : CLIENT_DEFAULT_ROLES;
  const now = new Date().toISOString();

  for (const role of roles) {
    try {
      await docClient.send(new PutCommand({
        TableName: TABLES.ROLES,
        Item: {
          orgId,
          roleId: role.roleId,
          roleName: role.roleName,
          roleLevel: role.roleLevel,
          isSystem: role.isSystem,
          description: role.description,
          permissions: role.permissions,
          createdBy: 'system',
          createdAt: now,
          updatedAt: now,
        },
        // Don't overwrite if already exists — preserves custom edits
        ConditionExpression: 'attribute_not_exists(orgId)',
      }));
    } catch (error) {
      // ConditionalCheckFailedException = already exists, which is fine
      if (error.name !== 'ConditionalCheckFailedException') {
        console.error(`  ✗ Role ${role.roleId} for org ${orgId}:`, error.message);
      }
    }
  }
}

// ──────────────────────────────────────
// MAIN — Run when executed directly
// ──────────────────────────────────────

async function main() {
  console.log('=== RBAC Seed Defaults ===');

  await seedPlans();

  console.log('\n--- Default roles will be seeded per-org during backfill or org creation ---');
  console.log('  → Run backfillSuperAdmins.js to seed roles for existing orgs.');

  console.log('\n=== Done ===');
}

main().catch(console.error);
