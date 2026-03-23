// ============================================================
// FILE: suspensionScheduler.js
// PURPOSE: Periodically auto-reactivates members whose suspension has expired.
// CONNECTS TO: rbac_members table, rbac_audit_log table, RBAC module bootstrap
// ============================================================

import { ScanCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import crypto from 'crypto';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';

const INTERVAL_MS = Math.max(parseInt(process.env.RBAC_SUSPENSION_SWEEP_INTERVAL_MS || '60000', 10), 10000);
const BATCH_SIZE = Math.min(Math.max(parseInt(process.env.RBAC_SUSPENSION_SWEEP_BATCH_SIZE || '100', 10), 1), 500);

let timer = null;
let running = false;

function buildEventId() {
  if (typeof crypto.randomUUID === 'function') {
    return `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function logAutoUnsuspend(orgId, targetUserId, targetEmail, suspendedUntil, now) {
  await docClient.send(new PutCommand({
    TableName: TABLES.AUDIT_LOG,
    Item: {
      orgId,
      eventId: buildEventId(),
      userId: 'system_scheduler',
      actorEmail: 'system@local',
      action: 'MEMBER_AUTO_UNSUSPENDED',
      details: {
        targetUserId,
        targetEmail,
        suspendedUntil,
        autoUnsuspendedAt: now,
      },
      timestamp: now,
    },
  }));
}

async function reactivateExpiredMember(member, now) {
  await docClient.send(new UpdateCommand({
    TableName: TABLES.MEMBERS,
    Key: { orgId: member.orgId, userId: member.userId },
    ConditionExpression: '#s = :suspended AND suspendedUntil = :until',
    UpdateExpression: 'SET #s = :active, updatedAt = :now, unsuspendedAt = :now, unsuspendedBy = :system, unsuspendReason = :reason REMOVE suspendedUntil, suspendedAt, suspendedBy, suspensionReason',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':suspended': 'suspended',
      ':active': 'active',
      ':until': member.suspendedUntil,
      ':now': now,
      ':system': 'system_scheduler',
      ':reason': 'Suspension period expired automatically',
    },
  }));

  await logAutoUnsuspend(member.orgId, member.userId, member.email || '', member.suspendedUntil, now);
}

async function sweepExpiredSuspensions() {
  if (running) return;
  running = true;

  try {
    const now = new Date().toISOString();
    let lastKey;
    let processed = 0;

    do {
      const result = await docClient.send(new ScanCommand({
        TableName: TABLES.MEMBERS,
        ExclusiveStartKey: lastKey,
        FilterExpression: '#s = :suspended AND attribute_exists(suspendedUntil) AND suspendedUntil <= :now',
        ProjectionExpression: 'orgId, userId, email, suspendedUntil, #s',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':suspended': 'suspended',
          ':now': now,
        },
        Limit: BATCH_SIZE,
      }));

      for (const member of (result.Items || [])) {
        try {
          await reactivateExpiredMember(member, now);
          processed += 1;
        } catch (err) {
          if (err.name !== 'ConditionalCheckFailedException') {
            console.error('[RBAC] Auto-unsuspend update failed:', err.message);
          }
        }
      }

      lastKey = result.LastEvaluatedKey;
    } while (lastKey && processed < BATCH_SIZE);

    if (processed > 0) {
      console.log(`[RBAC] Auto-unsuspended ${processed} member(s)`);
    }
  } catch (err) {
    console.error('[RBAC] Suspension sweep failed:', err.message);
  } finally {
    running = false;
  }
}

export function initializeSuspensionScheduler() {
  if (timer) return;

  timer = setInterval(() => {
    sweepExpiredSuspensions().catch((err) => {
      console.error('[RBAC] Suspension scheduler unexpected error:', err.message);
    });
  }, INTERVAL_MS);

  timer.unref?.();
  sweepExpiredSuspensions().catch((err) => {
    console.error('[RBAC] Initial suspension sweep failed:', err.message);
  });

  console.log(`[RBAC] Suspension scheduler started (interval=${INTERVAL_MS}ms, batch=${BATCH_SIZE})`);
}
