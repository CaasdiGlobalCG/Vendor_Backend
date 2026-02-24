// ============================================================
// FILE: createTables.js
// PURPOSE: Creates all 6 RBAC DynamoDB tables with GSIs and LSIs.
//          Run once per environment. Safe to re-run (skips existing tables).
// CONNECTS TO: tables.js (table name constants)
// ============================================================
// USAGE: node modules/rbac/scripts/createTables.js
// ============================================================

import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { dynamoClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';

// ──────────────────────────────────────
// TABLE DEFINITIONS
// ──────────────────────────────────────

const TABLE_DEFINITIONS = [
  // 1. rbac_organizations — links vendorId/clientId to RBAC metadata
  {
    TableName: TABLES.ORGANIZATIONS,
    KeySchema: [
      { AttributeName: 'orgId', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'orgId', AttributeType: 'S' },
      { AttributeName: 'superAdminUserId', AttributeType: 'S' },
      { AttributeName: 'orgType', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'SuperAdminIndex',
        KeySchema: [
          { AttributeName: 'superAdminUserId', KeyType: 'HASH' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'OrgTypeIndex',
        KeySchema: [
          { AttributeName: 'orgType', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 2. rbac_roles — system + custom roles per org
  {
    TableName: TABLES.ROLES,
    KeySchema: [
      { AttributeName: 'orgId', KeyType: 'HASH' },
      { AttributeName: 'roleId', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'orgId', AttributeType: 'S' },
      { AttributeName: 'roleId', AttributeType: 'S' },
      { AttributeName: 'roleLevel', AttributeType: 'N' },
    ],
    LocalSecondaryIndexes: [
      {
        IndexName: 'RoleLevelIndex',
        KeySchema: [
          { AttributeName: 'orgId', KeyType: 'HASH' },
          { AttributeName: 'roleLevel', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 3. rbac_members — user-to-org membership with role
  {
    TableName: TABLES.MEMBERS,
    KeySchema: [
      { AttributeName: 'orgId', KeyType: 'HASH' },
      { AttributeName: 'userId', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'orgId', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'email', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'UserOrgsIndex',
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'orgId', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'EmailIndex',
        KeySchema: [
          { AttributeName: 'email', KeyType: 'HASH' },
          { AttributeName: 'orgId', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 4. rbac_invitations — invitation records with TTL
  {
    TableName: TABLES.INVITATIONS,
    KeySchema: [
      { AttributeName: 'inviteId', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'inviteId', AttributeType: 'S' },
      { AttributeName: 'orgId', AttributeType: 'S' },
      { AttributeName: 'email', AttributeType: 'S' },
      { AttributeName: 'inviteToken', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'OrgInvitesIndex',
        KeySchema: [
          { AttributeName: 'orgId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'EmailInvitesIndex',
        KeySchema: [
          { AttributeName: 'email', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'TokenIndex',
        KeySchema: [
          { AttributeName: 'inviteToken', KeyType: 'HASH' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 5. rbac_audit_log — activity audit trail
  {
    TableName: TABLES.AUDIT_LOG,
    KeySchema: [
      { AttributeName: 'orgId', KeyType: 'HASH' },
      { AttributeName: 'eventId', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'orgId', AttributeType: 'S' },
      { AttributeName: 'eventId', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'UserAuditIndex',
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'eventId', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 6. rbac_subscription_plans — static plan definitions
  {
    TableName: TABLES.SUBSCRIPTION_PLANS,
    KeySchema: [
      { AttributeName: 'planId', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'planId', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
];

// ──────────────────────────────────────
// EXECUTION
// ──────────────────────────────────────

/**
 * Check if a table already exists.
 * @param {string} tableName
 * @returns {Promise<boolean>}
 */
async function tableExists(tableName) {
  try {
    await dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') return false;
    throw error;
  }
}

/**
 * Create all RBAC tables. Skips tables that already exist.
 */
async function createAllTables() {
  console.log('=== RBAC Table Creation ===\n');

  for (const tableDef of TABLE_DEFINITIONS) {
    const name = tableDef.TableName;

    if (await tableExists(name)) {
      console.log(`✓ ${name} — already exists, skipping.`);
      continue;
    }

    try {
      await dynamoClient.send(new CreateTableCommand(tableDef));
      console.log(`✓ ${name} — created successfully.`);
    } catch (error) {
      console.error(`✗ ${name} — FAILED:`, error.message);
    }
  }

  // Enable TTL on invitations table (auto-expire invites)
  console.log('\n--- Enabling TTL ---');
  try {
    const { UpdateTimeToLiveCommand } = await import('@aws-sdk/client-dynamodb');
    await dynamoClient.send(new UpdateTimeToLiveCommand({
      TableName: TABLES.INVITATIONS,
      TimeToLiveSpecification: {
        AttributeName: 'expiresAt',
        Enabled: true,
      },
    }));
    console.log(`✓ TTL enabled on ${TABLES.INVITATIONS} (attribute: expiresAt)`);
  } catch (error) {
    // TTL might already be enabled or table might still be creating
    if (error.name === 'ValidationException' && error.message.includes('already enabled')) {
      console.log(`✓ TTL already enabled on ${TABLES.INVITATIONS}`);
    } else {
      console.warn(`⚠ TTL on ${TABLES.INVITATIONS}:`, error.message);
    }
  }

  // Enable TTL on audit_log table (auto-archive old events)
  try {
    const { UpdateTimeToLiveCommand } = await import('@aws-sdk/client-dynamodb');
    await dynamoClient.send(new UpdateTimeToLiveCommand({
      TableName: TABLES.AUDIT_LOG,
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
    }));
    console.log(`✓ TTL enabled on ${TABLES.AUDIT_LOG} (attribute: ttl)`);
  } catch (error) {
    if (error.name === 'ValidationException' && error.message.includes('already enabled')) {
      console.log(`✓ TTL already enabled on ${TABLES.AUDIT_LOG}`);
    } else {
      console.warn(`⚠ TTL on ${TABLES.AUDIT_LOG}:`, error.message);
    }
  }

  console.log('\n=== Done ===');
}

// Run if executed directly
createAllTables().catch(console.error);
