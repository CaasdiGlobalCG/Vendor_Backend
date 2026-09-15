#!/usr/bin/env node
// ============================================================
// FILE: scripts/createExternalHandoffTable.js
// PURPOSE: One-time script to create the DynamoDB `external_handoff_codes`
//          table. PK = code. TTL on `ttl` attribute for auto-cleanup.
//          Written by the Employee backend; consumed by
//          GET /api/auth/handoff/external-exchange.
// RUN:     node scripts/createExternalHandoffTable.js
// ============================================================

import { DynamoDBClient, CreateTableCommand, UpdateTimeToLiveCommand } from '@aws-sdk/client-dynamodb';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '.env') });

const TABLE = process.env.EXTERNAL_HANDOFF_TABLE || 'external_handoff_codes';
const REGION = process.env.AWS_REGION || 'ap-south-1';

async function createTable() {
  const client = new DynamoDBClient({ region: REGION });

  console.log(`Creating DynamoDB table: ${TABLE} in ${REGION}...`);

  try {
    await client.send(new CreateTableCommand({
      TableName: TABLE,
      KeySchema: [
        { AttributeName: 'code', KeyType: 'HASH' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'code', AttributeType: 'S' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }));

    console.log(`Table "${TABLE}" created successfully.`);

    console.log('Waiting 5s for table to become ACTIVE...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    await client.send(new UpdateTimeToLiveCommand({
      TableName: TABLE,
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
    }));

    console.log('TTL enabled on attribute "ttl".');
    console.log('\nDone! The external_handoff_codes table is ready.');
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
