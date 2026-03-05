// ============================================================
// FILE: upgradeAdminPermissions.js
// PURPOSE: One-time migration to upgrade Admin & Sales Admin roles
//          from user_management:view/create/edit → user_management:manage.
//          This allows Admins to create/edit/delete custom roles.
// CONNECTS TO: rbac_roles table, rbac_organizations table
// ============================================================
// USAGE: node modules/rbac/scripts/upgradeAdminPermissions.js
// ============================================================

import { ScanCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';

/** Old permissions to remove */
const OLD_PERMS = ['user_management:view', 'user_management:create', 'user_management:edit'];
/** New permission to add */
const NEW_PERM = 'user_management:manage';
/** Role IDs to upgrade */
const TARGET_ROLES = ['admin', 'sales_admin'];

/**
 * Scan all orgs, then update admin/sales_admin roles in each.
 */
async function main() {
  console.log('=== Upgrade Admin Permissions: user_management → manage ===\n');

  // 1. Get all orgs
  let orgs = [];
  let lastKey = undefined;
  do {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLES.ORGANIZATIONS,
      ProjectionExpression: 'orgId, orgType, orgName',
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }));
    orgs.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  console.log(`Found ${orgs.length} organizations.\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const org of orgs) {
    for (const roleId of TARGET_ROLES) {
      try {
        // Get current role
        const roleResult = await docClient.send(new QueryCommand({
          TableName: TABLES.ROLES,
          KeyConditionExpression: 'orgId = :orgId AND roleId = :roleId',
          ExpressionAttributeValues: { ':orgId': org.orgId, ':roleId': roleId },
        }));

        const role = roleResult.Items?.[0];
        if (!role) continue; // Role doesn't exist for this org (e.g., client orgs don't have sales_admin)

        const perms = role.permissions || [];
        const permSet = new Set(perms);

        // Check if already upgraded
        if (permSet.has(NEW_PERM)) {
          console.log(`  ⊘ ${org.orgId} / ${roleId} — already has ${NEW_PERM}, skipping`);
          skipped++;
          continue;
        }

        // Check if has old perms
        const hasOld = OLD_PERMS.some(p => permSet.has(p));
        if (!hasOld) {
          console.log(`  ⊘ ${org.orgId} / ${roleId} — no old perms found, skipping`);
          skipped++;
          continue;
        }

        // Remove old, add new
        OLD_PERMS.forEach(p => permSet.delete(p));
        permSet.add(NEW_PERM);
        const newPerms = [...permSet];

        await docClient.send(new UpdateCommand({
          TableName: TABLES.ROLES,
          Key: { orgId: org.orgId, roleId },
          UpdateExpression: 'SET #perms = :perms, updatedAt = :now',
          ExpressionAttributeNames: { '#perms': 'permissions' },
          ExpressionAttributeValues: {
            ':perms': newPerms,
            ':now': new Date().toISOString(),
          },
        }));

        console.log(`  ✓ ${org.orgId} / ${roleId} — upgraded (${org.orgName || 'unnamed'})`);
        updated++;
      } catch (err) {
        console.error(`  ✗ ${org.orgId} / ${roleId} — ERROR: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors:  ${errors}`);
}

main().catch(console.error);
