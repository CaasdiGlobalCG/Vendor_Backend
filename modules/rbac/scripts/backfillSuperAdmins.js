// ============================================================
// FILE: backfillSuperAdmins.js
// PURPOSE: Scans existing vendors and clients tables, creates RBAC records
//          so every existing account owner becomes a Super Admin.
//          Safe to re-run — skips orgs that already have RBAC records.
// CONNECTS TO: vendors table, clients table, users table,
//              rbac_organizations, rbac_roles, rbac_members,
//              seedDefaults.js (seedRolesForOrg)
// ============================================================
// USAGE: node modules/rbac/scripts/backfillSuperAdmins.js
// ============================================================

import { ScanCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES, EXISTING_TABLES } from '../config/tables.js';
import { seedRolesForOrg } from './seedDefaults.js';

// ──────────────────────────────────────
// HELPERS
// ──────────────────────────────────────

/**
 * Scan all items from a table (handles pagination automatically).
 * @param {string} tableName
 * @param {string} [projectionExpression] - Fields to retrieve
 * @returns {Promise<Object[]>}
 */
async function scanAll(tableName, projectionExpression) {
  const items = [];
  let lastKey = undefined;

  do {
    const params = {
      TableName: tableName,
      ExclusiveStartKey: lastKey,
    };
    if (projectionExpression) {
      params.ProjectionExpression = projectionExpression;
    }

    const result = await docClient.send(new ScanCommand(params));
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

/**
 * Find the user record (from users table) that matches a vendor/client email.
 * This gives us the Cognito sub (userId) for the owner.
 *
 * @param {string} email
 * @returns {Promise<Object|null>} User record or null
 */
async function findUserByEmail(email) {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: EXISTING_TABLES.USERS,
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
      Limit: 1,
    }));
    return result.Items?.[0] || null;
  } catch (error) {
    console.warn(`  ⚠ Could not look up user by email ${email}:`, error.message);
    return null;
  }
}

// ──────────────────────────────────────
// CREATE RBAC RECORDS FOR ONE ORGANIZATION
// ──────────────────────────────────────

/**
 * Create the full RBAC setup for an existing organization owner:
 * 1. rbac_organizations record
 * 2. All default roles for the org
 * 3. rbac_members record (mapping owner as Super Admin)
 *
 * @param {Object} params
 * @param {string} params.orgId - vendorId or clientId
 * @param {'vendor'|'client'} params.orgType
 * @param {string} params.orgName - Company name
 * @param {string} params.userId - Owner's Cognito sub (from users table)
 * @param {string} params.email - Owner's email
 */
async function createOrgRBAC({ orgId, orgType, orgName, userId, email }) {
  const now = new Date().toISOString();

  // 1. Create organization record
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
        currentSeatCount: 1,  // The owner is seat #1
        createdAt: now,
        updatedAt: now,
      },
      // Don't overwrite existing — safe re-run
      ConditionExpression: 'attribute_not_exists(orgId)',
    }));
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      return; // Already backfilled — skip quietly
    }
    throw error;
  }

  // 2. Seed default roles for this org
  await seedRolesForOrg(orgId, orgType);

  // 3. Create member record — owner as Super Admin
  await docClient.send(new PutCommand({
    TableName: TABLES.MEMBERS,
    Item: {
      orgId,
      userId,
      email,
      displayName: orgName || email,
      roleId: 'super_admin',
      roleName: 'Super Admin',
      status: 'active',
      invitedBy: 'system',
      joinedAt: now,
      lastActiveAt: now,
    },
    ConditionExpression: 'attribute_not_exists(orgId)',
  }));

  // 4. Update the users table to mark this user as org owner
  try {
    const updateParams = {
      TableName: EXISTING_TABLES.USERS,
      Key: { id: userId },
      UpdateExpression: 'SET isOrgOwner = :true, accountType = :owner, updatedAt = :now',
      ExpressionAttributeValues: {
        ':true': true,
        ':owner': 'owner',
        ':now': now,
      },
    };

    // Add the org link based on type
    if (orgType === 'vendor') {
      updateParams.UpdateExpression += ', vendorOrgId = :orgId';
      updateParams.ExpressionAttributeValues[':orgId'] = orgId;
    } else {
      updateParams.UpdateExpression += ', clientOrgId = :orgId';
      updateParams.ExpressionAttributeValues[':orgId'] = orgId;
    }

    await docClient.send(new UpdateCommand(updateParams));
  } catch (error) {
    console.warn(`  ⚠ Could not update users table for ${email}:`, error.message);
  }
}

// ──────────────────────────────────────
// MAIN — BACKFILL ALL EXISTING ACCOUNTS
// ──────────────────────────────────────

async function main() {
  console.log('=== RBAC Backfill — Make Existing Owners Super Admins ===\n');

  let vendorCount = 0;
  let clientCount = 0;
  let skipped = 0;
  let errors = 0;

  // ─── VENDORS ───
  console.log('--- Scanning vendors table ---');
  const vendors = await scanAll(EXISTING_TABLES.VENDORS, 'vendorId, companyName, email');
  console.log(`  Found ${vendors.length} vendor records.\n`);

  for (const vendor of vendors) {
    const { vendorId, companyName, email } = vendor;
    if (!vendorId || !email) {
      console.log(`  ⚠ Skipping vendor with missing vendorId or email:`, vendor);
      skipped++;
      continue;
    }

    // Look up the owner's userId from the users table
    const user = await findUserByEmail(email);
    if (!user) {
      console.log(`  ⚠ No user record found for vendor email ${email}. Skipping.`);
      skipped++;
      continue;
    }

    try {
      await createOrgRBAC({
        orgId: vendorId,
        orgType: 'vendor',
        orgName: companyName,
        userId: user.id,
        email,
      });
      console.log(`  ✓ Vendor: ${companyName || vendorId} (${email}) → Super Admin`);
      vendorCount++;
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        skipped++;
      } else {
        console.error(`  ✗ Vendor ${vendorId}:`, error.message);
        errors++;
      }
    }
  }

  // ─── CLIENTS ───
  console.log('\n--- Scanning clients table ---');
  const clients = await scanAll(EXISTING_TABLES.CLIENTS, 'clientId, companyName, email');
  console.log(`  Found ${clients.length} client records.\n`);

  for (const client of clients) {
    const { clientId, companyName, email } = client;
    if (!clientId || !email) {
      console.log(`  ⚠ Skipping client with missing clientId or email:`, client);
      skipped++;
      continue;
    }

    const user = await findUserByEmail(email);
    if (!user) {
      console.log(`  ⚠ No user record found for client email ${email}. Skipping.`);
      skipped++;
      continue;
    }

    try {
      await createOrgRBAC({
        orgId: clientId,
        orgType: 'client',
        orgName: companyName,
        userId: user.id,
        email,
      });
      console.log(`  ✓ Client: ${companyName || clientId} (${email}) → Super Admin`);
      clientCount++;
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        skipped++;
      } else {
        console.error(`  ✗ Client ${clientId}:`, error.message);
        errors++;
      }
    }
  }

  // ─── SUMMARY ───
  console.log('\n=== Backfill Complete ===');
  console.log(`  Vendors backfilled: ${vendorCount}`);
  console.log(`  Clients backfilled: ${clientCount}`);
  console.log(`  Skipped (already exists or missing data): ${skipped}`);
  console.log(`  Errors: ${errors}`);
}

main().catch(console.error);
