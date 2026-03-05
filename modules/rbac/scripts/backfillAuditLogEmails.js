// ============================================================
// FILE: backfillAuditLogEmails.js
// PURPOSE: Scans rbac_audit_log entries that are missing actorEmail,
//          resolves userId → email via rbac_members, and patches
//          each log item with the actorEmail field.
//          Safe to re-run — only updates logs missing actorEmail.
// CONNECTS TO: rbac_audit_log table, rbac_members table
// ============================================================
// USAGE: node modules/rbac/scripts/backfillAuditLogEmails.js
// ============================================================

import { ScanCommand, UpdateCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';

// ──────────────────────────────────────
// HELPERS
// ──────────────────────────────────────

/**
 * Scan all audit log items missing actorEmail (paginated).
 * @returns {Promise<Object[]>} Log items without actorEmail
 */
async function scanLogsMissingEmail() {
  const items = [];
  let lastKey = undefined;

  do {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLES.AUDIT_LOG,
      FilterExpression: 'attribute_not_exists(actorEmail)',
      ProjectionExpression: 'orgId, eventId, userId',
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
    // Progress indicator for large tables
    if (items.length % 500 === 0 && items.length > 0) {
      console.log(`  ... scanned ${items.length} logs so far`);
    }
  } while (lastKey);

  return items;
}

/**
 * Batch-resolve userIds to emails via rbac_members table.
 * Groups by orgId since member PK = (orgId, userId).
 *
 * @param {Array<{orgId: string, userId: string}>} orgUserPairs
 * @returns {Promise<Map<string, {email: string, displayName: string}>>}
 *   Map keyed by `${orgId}#${userId}`
 */
async function resolveEmails(orgUserPairs) {
  const resultMap = new Map();
  // Deduplicate
  const uniqueKeys = [];
  const seen = new Set();
  for (const { orgId, userId } of orgUserPairs) {
    const key = `${orgId}#${userId}`;
    if (!seen.has(key) && orgId && userId) {
      seen.add(key);
      uniqueKeys.push({ orgId, userId });
    }
  }

  // BatchGet in chunks of 100 (DynamoDB limit)
  for (let i = 0; i < uniqueKeys.length; i += 100) {
    const batch = uniqueKeys.slice(i, i + 100);
    try {
      const response = await docClient.send(new BatchGetCommand({
        RequestItems: {
          [TABLES.MEMBERS]: {
            Keys: batch.map(({ orgId, userId }) => ({ orgId, userId })),
            ProjectionExpression: 'orgId, userId, email, displayName',
          },
        },
      }));
      for (const item of (response.Responses?.[TABLES.MEMBERS] || [])) {
        resultMap.set(`${item.orgId}#${item.userId}`, {
          email: item.email || '',
          displayName: item.displayName || '',
        });
      }
    } catch (err) {
      console.error(`  ✗ BatchGet error (chunk ${i}):`, err.message);
    }
  }

  return resultMap;
}

// ──────────────────────────────────────
// MAIN
// ──────────────────────────────────────

async function main() {
  console.log('=== Backfill: Patch actorEmail into Old Audit Logs ===\n');

  // Step 1: Find all audit logs without actorEmail
  console.log('Step 1: Scanning rbac_audit_log for entries missing actorEmail ...');
  const logs = await scanLogsMissingEmail();
  console.log(`  Found ${logs.length} log entries missing actorEmail.\n`);

  if (logs.length === 0) {
    console.log('✓ Nothing to backfill — all logs already have actorEmail.');
    return;
  }

  // Step 2: Resolve userId → email via rbac_members
  console.log('Step 2: Resolving user emails from rbac_members ...');
  const emailMap = await resolveEmails(
    logs.map((l) => ({ orgId: l.orgId, userId: l.userId }))
  );
  console.log(`  Resolved ${emailMap.size} unique org+user combinations.\n`);

  // Step 3: Patch each log entry
  console.log('Step 3: Updating log entries ...');
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const log of logs) {
    const key = `${log.orgId}#${log.userId}`;
    const resolved = emailMap.get(key);

    if (!resolved || !resolved.email) {
      skipped++;
      continue;
    }

    try {
      const updateExpr = resolved.displayName
        ? 'SET actorEmail = :email, actorName = :name'
        : 'SET actorEmail = :email';
      const exprValues = { ':email': resolved.email };
      if (resolved.displayName) {
        exprValues[':name'] = resolved.displayName;
      }

      await docClient.send(new UpdateCommand({
        TableName: TABLES.AUDIT_LOG,
        Key: { orgId: log.orgId, eventId: log.eventId },
        UpdateExpression: updateExpr,
        ExpressionAttributeValues: exprValues,
        // Only update if still missing (idempotent)
        ConditionExpression: 'attribute_not_exists(actorEmail)',
      }));
      updated++;

      if (updated % 100 === 0) {
        console.log(`  ... updated ${updated} logs`);
      }
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        skipped++; // Another process already patched it
      } else {
        console.error(`  ✗ Failed to update log ${log.eventId}:`, err.message);
        errors++;
      }
    }
  }

  // ─── SUMMARY ───
  console.log('\n=== Backfill Complete ===');
  console.log(`  Total logs scanned:    ${logs.length}`);
  console.log(`  Updated with email:    ${updated}`);
  console.log(`  Skipped (no email):    ${skipped}`);
  console.log(`  Errors:                ${errors}`);

  if (skipped > 0) {
    console.log('\n  ℹ Skipped entries had no matching rbac_members record.');
    console.log('    Those users need to log in once (auto-creates member record),');
    console.log('    then re-run this script to patch their logs.');
  }
}

main().catch(console.error);
