// ============================================================
// FILE: createSecurityLogTable.js
// PURPOSE: Creates the security_log DynamoDB table with 2 GSIs
//          (ActorIndex and ActionIndex). Run once to set up.
// CONNECTS TO: DynamoDB (uses same region/credentials as RBAC)
// ============================================================

import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from Vendor_Backend root (works for all backends — same AWS creds)
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const TABLE_NAME = process.env.SECURITY_LOG_TABLE || 'security_log';
const REGION = process.env.AWS_REGION || 'us-east-1';

const client = new DynamoDBClient({ region: REGION });

/**
 * Creates the security_log table if it doesn't already exist.
 *
 * Schema:
 *   PK: orgId (String) — partition by organization
 *   SK: eventId (String) — "ISO-timestamp#randomSuffix" for time ordering
 *
 * GSIs:
 *   1. ActorIndex: actorId (HASH) + eventId (RANGE)
 *      → "Show all security events for this user"
 *
 *   2. ActionIndex: orgId#action (HASH) + eventId (RANGE)
 *      → "Show all LOGIN_FAILED events for this org"
 */
async function createTable() {
  // Check if table already exists
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    console.log(`✅ Table "${TABLE_NAME}" already exists. No action needed.`);
    return;
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') {
      console.error('Error checking table:', err.message);
      throw err;
    }
    // Table doesn't exist — proceed with creation
  }

  const params = {
    TableName: TABLE_NAME,
    BillingMode: 'PAY_PER_REQUEST', // On-Demand — no capacity planning needed
    KeySchema: [
      { AttributeName: 'orgId', KeyType: 'HASH' },
      { AttributeName: 'eventId', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'orgId', AttributeType: 'S' },
      { AttributeName: 'eventId', AttributeType: 'S' },
      { AttributeName: 'actorId', AttributeType: 'S' },
      { AttributeName: 'orgId#action', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'ActorIndex',
        KeySchema: [
          { AttributeName: 'actorId', KeyType: 'HASH' },
          { AttributeName: 'eventId', KeyType: 'RANGE' },
        ],
        Projection: {
          ProjectionType: 'INCLUDE',
          NonKeyAttributes: ['action', 'timestamp', 'metadata', 'actorEmail', 'orgId'],
        },
      },
      {
        IndexName: 'ActionIndex',
        KeySchema: [
          { AttributeName: 'orgId#action', KeyType: 'HASH' },
          { AttributeName: 'eventId', KeyType: 'RANGE' },
        ],
        Projection: {
          ProjectionType: 'ALL', // Need all fields when querying by action type
        },
      },
    ],
    // Enable TTL for automatic retention management
    // Note: TTL must be enabled separately via UpdateTimeToLive after table creation
  };

  try {
    await client.send(new CreateTableCommand(params));
    console.log(`✅ Table "${TABLE_NAME}" created successfully.`);
    console.log('');
    console.log('⚠️  IMPORTANT: Enable TTL on the "ttl" attribute manually:');
    console.log(`   aws dynamodb update-time-to-live --table-name ${TABLE_NAME} \\`);
    console.log('     --time-to-live-specification "Enabled=true, AttributeName=ttl"');
    console.log('');
    console.log('Table Schema:');
    console.log('  PK: orgId (String)');
    console.log('  SK: eventId (String) — "ISO-timestamp#randomSuffix"');
    console.log('  GSI ActorIndex: actorId (HASH) + eventId (RANGE)');
    console.log('  GSI ActionIndex: orgId#action (HASH) + eventId (RANGE)');
  } catch (err) {
    console.error('❌ Failed to create table:', err.message);
    throw err;
  }
}

createTable().catch(() => process.exit(1));
