#!/usr/bin/env node
// ============================================================
// FILE: scripts/createSessionTable.js
// PURPOSE: One-time script to create the DynamoDB `app_sessions` table.
//          PK = sid (session ID). TTL on `ttl` attribute for auto-cleanup.
// RUN:     node scripts/createSessionTable.js
// ============================================================

import { DynamoDBClient, CreateTableCommand, UpdateTimeToLiveCommand } from '@aws-sdk/client-dynamodb';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '.env') });

const TABLE = process.env.SESSION_TABLE || 'app_sessions';
const REGION = process.env.AWS_REGION || 'ap-south-1';

async function createTable() {
  const client = new DynamoDBClient({ region: REGION });

  console.log(`Creating DynamoDB table: ${TABLE} in ${REGION}...`);

  try {
    await client.send(new CreateTableCommand({
      TableName: TABLE,
      KeySchema: [
        { AttributeName: 'sid', KeyType: 'HASH' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'sid', AttributeType: 'S' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }));

    console.log(`Table "${TABLE}" created successfully.`);

    // Wait a moment for the table to become active
    console.log('Waiting 5s for table to become ACTIVE...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Enable TTL on the `ttl` attribute
    await client.send(new UpdateTimeToLiveCommand({
      TableName: TABLE,
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
    }));

    console.log('TTL enabled on attribute "ttl".');
    console.log('\nDone! The app_sessions table is ready.');
  } catch (err) {
    if (err.name === 'ResourceInUseException') {
      console.log(`Table "${TABLE}" already exists — skipping creation.`);
      return;
    }
    console.error('Error creating table:', err?.message || err);
    process.exit(1);
  }
}

createTable();
