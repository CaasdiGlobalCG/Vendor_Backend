// ============================================================
// FILE: backfillMemberScopes.js
// PURPOSE: Backfills missing projectAccess/workspaceAccess fields in rbac_members.
//          Safe default for legacy members is wildcard access ['*'].
// RUN: node modules/rbac/scripts/backfillMemberScopes.js
// ENV:
//   BACKFILL_DRY_RUN=true|false (default: true)
// ============================================================

import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';

const DRY_RUN = String(process.env.BACKFILL_DRY_RUN || 'true').toLowerCase() !== 'false';
const DEFAULT_SCOPE = ['*'];
const FORCE_FULL_SCOPE_ROLES = new Set(['super_admin', 'admin']);

function hasMissingScopes(member) {
  const missingProject = !Array.isArray(member.projectAccess);
  const missingWorkspace = !Array.isArray(member.workspaceAccess);
  const forceFullScope = FORCE_FULL_SCOPE_ROLES.has(String(member.roleId || '').toLowerCase());
  const notFullProject = !Array.isArray(member.projectAccess) || !member.projectAccess.includes('*');
  const notFullWorkspace = !Array.isArray(member.workspaceAccess) || !member.workspaceAccess.includes('*');
  return missingProject || missingWorkspace || (forceFullScope && (notFullProject || notFullWorkspace));
}

async function updateMemberScopes(orgId, userId, member) {
  const roleId = String(member.roleId || '').toLowerCase();
  const forceFullScope = FORCE_FULL_SCOPE_ROLES.has(roleId);

  const projectAccess = forceFullScope
    ? DEFAULT_SCOPE
    : (Array.isArray(member.projectAccess) ? member.projectAccess : DEFAULT_SCOPE);

  const workspaceAccess = forceFullScope
    ? DEFAULT_SCOPE
    : (Array.isArray(member.workspaceAccess) ? member.workspaceAccess : DEFAULT_SCOPE);

  if (DRY_RUN) {
    console.log(`[DRY RUN] would update org=${orgId} user=${userId} projectAccess=${JSON.stringify(projectAccess)} workspaceAccess=${JSON.stringify(workspaceAccess)}`);
    return;
  }

  await docClient.send(new UpdateCommand({
    TableName: TABLES.MEMBERS,
    Key: { orgId, userId },
    UpdateExpression: 'SET projectAccess = :projectAccess, workspaceAccess = :workspaceAccess, updatedAt = :now',
    ExpressionAttributeValues: {
      ':projectAccess': projectAccess,
      ':workspaceAccess': workspaceAccess,
      ':now': new Date().toISOString(),
    },
  }));

  console.log(`updated org=${orgId} user=${userId}`);
}

async function main() {
  console.log('=== RBAC Member Scope Backfill ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'}`);

  let scanned = 0;
  let changed = 0;
  let lastKey;

  do {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLES.MEMBERS,
      ProjectionExpression: 'orgId, userId, roleId, projectAccess, workspaceAccess',
      ExclusiveStartKey: lastKey,
      Limit: 200,
    }));

    const members = result.Items || [];
    scanned += members.length;

    for (const member of members) {
      if (!hasMissingScopes(member)) continue;
      await updateMemberScopes(member.orgId, member.userId, member);
      changed += 1;
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  console.log(`Scanned: ${scanned}`);
  console.log(`${DRY_RUN ? 'Would update' : 'Updated'}: ${changed}`);
  console.log('=== Done ===');
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
