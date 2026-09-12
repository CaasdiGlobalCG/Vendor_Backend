// ============================================================
// FILE: backfillClientOrgIds.js
// PURPOSE: Backfills the `clientId` field on rbac_organizations for
//          existing client orgs. Scans the users table for records
//          that have `clientOrgId` (the real clients table PK) and
//          stamps it onto the corresponding rbac_organizations record
//          (matched by `parentOrgId` = rbac_organizations.orgId).
//
//          This mirrors the `vendorId` metadata column that vendor
//          orgs already have, enabling team-member lookups in the
//          client backend to resolve the real clients table PK.
//
// CONNECTS TO: users table (scan for clientOrgId + parentOrgId),
//              rbac_organizations table (update clientId)
//
// USAGE:
//   Dry run (default):  node modules/rbac/scripts/backfillClientOrgIds.js
//   Apply changes:       BACKFILL_DRY_RUN=false node modules/rbac/scripts/backfillClientOrgIds.js
// ============================================================

import { ScanCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';

const DRY_RUN = process.env.BACKFILL_DRY_RUN !== 'false';
const USERS_TABLE = process.env.USERS_TABLE || 'users';
const ORGS_TABLE = TABLES.ORGANIZATIONS;

// ──────────────────────────────────────
// HELPERS
// ──────────────────────────────────────

/**
 * Scan all items from a table with an optional filter.
 * Handles pagination automatically.
 */
async function scanAll(tableName, filterExpression, expressionNames, expressionValues, projectionExpression) {
  const items = [];
  let lastKey = undefined;

  do {
    const params = {
      TableName: tableName,
      ExclusiveStartKey: lastKey,
    };
    if (filterExpression) {
      params.FilterExpression = filterExpression;
    }
    if (expressionNames) {
      params.ExpressionAttributeNames = expressionNames;
    }
    if (expressionValues) {
      params.ExpressionAttributeValues = expressionValues;
    }
    if (projectionExpression) {
      params.ProjectionExpression = projectionExpression;
    }

    const result = await docClient.send(new ScanCommand(params));
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

// ──────────────────────────────────────
// MAIN
// ──────────────────────────────────────

async function main() {
  console.log('=== Backfill clientId on rbac_organizations ===');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY (will write)'}`);
  console.log('');

  // Scan users table for records that have clientOrgId
  console.log('--- Scanning users table for clientOrgId ---');
  const users = await scanAll(
    USERS_TABLE,
    'attribute_exists(clientOrgId)',
    null,
    null,
    'userId, email, parentOrgId, clientOrgId'
  );
  console.log(`  Found ${users.length} users with clientOrgId.\n`);

  let stamped = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of users) {
    const { parentOrgId, clientOrgId, email } = user;

    if (!parentOrgId || !clientOrgId) {
      console.log(`  ⚠ Skipping ${email || 'unknown'} — missing parentOrgId or clientOrgId`);
      skipped++;
      continue;
    }

    // Check if rbac_organizations already has clientId set
    try {
      const orgResult = await docClient.send(new GetCommand({
        TableName: ORGS_TABLE,
        Key: { orgId: parentOrgId },
        ProjectionExpression: 'orgId, orgType, clientId',
      }));

      if (!orgResult.Item) {
        console.log(`  ⚠ Skipping ${email} — no rbac_organizations record for orgId ${parentOrgId}`);
        skipped++;
        continue;
      }

      if (orgResult.Item.clientId) {
        console.log(`  ⊘ Skipping ${email} — clientId already set (${orgResult.Item.clientId})`);
        skipped++;
        continue;
      }

      if (orgResult.Item.orgType && orgResult.Item.orgType !== 'client') {
        console.log(`  ⚠ Skipping ${email} — org ${parentOrgId} is type '${orgResult.Item.orgType}', not 'client'`);
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would stamp clientId=${clientOrgId} on org ${parentOrgId} (${email})`);
        stamped++;
        continue;
      }

      await docClient.send(new UpdateCommand({
        TableName: ORGS_TABLE,
        Key: { orgId: parentOrgId },
        UpdateExpression: 'SET clientId = :cid, updatedAt = :now',
        ExpressionAttributeValues: {
          ':cid': clientOrgId,
          ':now': new Date().toISOString(),
        },
      }));
      console.log(`  ✓ Stamped clientId=${clientOrgId} on org ${parentOrgId} (${email})`);
      stamped++;
    } catch (err) {
      console.error(`  ✗ Error for ${email} (${parentOrgId}):`, err.message);
      errors++;
    }
  }

  console.log('\n=== Backfill Complete ===');
  console.log(`  Stamped: ${stamped}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors:  ${errors}`);
}

main().catch(console.error);
