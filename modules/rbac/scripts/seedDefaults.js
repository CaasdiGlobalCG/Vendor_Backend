// ============================================================
// FILE: seedDefaults.js
// PURPOSE: Seeds default roles and subscription plans into DynamoDB.
//          Safe to re-run — uses PutItem with condition to skip existing records.
// CONNECTS TO: roles.js (default role definitions), plans.js (plan definitions),
//              tables.js (table names)
// ============================================================
// USAGE: node modules/rbac/scripts/seedDefaults.js
// ============================================================

import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
// PROVISION NEW ORG OWNER (called at signup)
// ──────────────────────────────────────

/**
 * Create the full RBAC setup for a brand-new organization owner.
 * Called immediately after vendor/client record creation during sign-up.
 * Safe to re-run — all writes use ConditionExpression so existing records
 * are never overwritten.
 *
 * Creates:
 *   1. rbac_organizations record
 *   2. Default rbac_roles for the org
 *   3. rbac_members record — owner as Super Admin (active)
 *
 * @param {Object} params
 * @param {string} params.orgId        - vendorId or clientId
 * @param {'vendor'|'client'} params.orgType
 * @param {string} params.orgName      - Display name for the org
 * @param {string} params.userId       - Owner's Cognito sub (JWT decoded.sub)
 * @param {string} params.email        - Owner's email
 * @returns {Promise<void>}
 */
export async function provisionOrgOwner({ orgId, orgType, orgName, userId, email, extraOrgFields = {} }) {
  const now = new Date().toISOString();

  // 1. Create rbac_organizations record
  // extraOrgFields can carry metadata like parentOrgId, vendorId, clientId
  // without affecting the orgId primary key used for membership lookups.
  try {
    await docClient.send(new PutCommand({
      TableName: TABLES.ORGANIZATIONS,
      Item: {
        orgId,
        orgType,
        orgName: orgName || `${orgType}-${orgId}`,
        superAdminUserId: userId,
        subscriptionPlan: 'free',
        maxSeats: 3,
        currentSeatCount: 1,
        createdAt: now,
        updatedAt: now,
        ...extraOrgFields,
      },
      ConditionExpression: 'attribute_not_exists(orgId)',
    }));
  } catch (err) {
    // Already exists — that's fine (idempotent re-run)
    if (err.name !== 'ConditionalCheckFailedException') throw err;
  }

  // 2. Seed default roles for this org
  await seedRolesForOrg(orgId, orgType);

  // 3. Create rbac_members record — owner as Super Admin
  try {
    await docClient.send(new PutCommand({
      TableName: TABLES.MEMBERS,
      Item: {
        orgId,
        userId,
        email: String(email || '').trim().toLowerCase(),
        displayName: orgName || (email ? String(email).split('@')[0] : 'Owner'),
        roleId: 'super_admin',
        roleName: 'Super Admin',
        orgType,
        status: 'active',
        platformAccess: ['vendor', 'client', 'sales'],
        invitedBy: 'system',
        isOrgOwner: true,
        joinedAt: now,
        lastActiveAt: now,
        updatedAt: now,
      },
      ConditionExpression: 'attribute_not_exists(orgId)',
    }));
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
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
