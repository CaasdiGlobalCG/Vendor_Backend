#!/usr/bin/env node
// ============================================================
// FILE: createIdentityTables.js
// PURPOSE: Create the shared users, vendors, and clients tables.
// CONNECTS TO: Cognito-authenticated application identity flows.
//
// Verified schemas:
//   users   -> PK id,       GSI EmailIndex(email)
//   vendors -> PK vendorId, GSI EmailIndex(email)
//   clients -> PK clientId, GSI EmailIndex(email)
//
// Billing mode is PAY_PER_REQUEST. Existing tables are inspected and skipped;
// this script never changes or deletes an existing table.
// RUN: node scripts/createIdentityTables.js
// ============================================================

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  UpdateTableCommand,
} from '@aws-sdk/client-dynamodb';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const REGION = process.env.AWS_REGION || 'ap-south-1';
const dynamoClient = new DynamoDBClient({ region: REGION });

const IDENTITY_TABLES = [
  {
    name: process.env.USERS_TABLE || 'users',
    partitionKey: 'id',
  },
  {
    name: process.env.VENDORS_TABLE || 'vendors',
    partitionKey: 'vendorId',
  },
  {
    name: process.env.CLIENTS_TABLE || 'clients',
    partitionKey: 'clientId',
  },
];

function createTableInput({ name, partitionKey }) {
  return {
    TableName: name,
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: [{ AttributeName: partitionKey, KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: partitionKey, AttributeType: 'S' },
      { AttributeName: 'email', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'EmailIndex',
        KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  };
}

async function ensureTable(table) {
  try {
    const existing = await dynamoClient.send(new DescribeTableCommand({
      TableName: table.name,
    }));
    const existingKey = existing.Table?.KeySchema?.find((key) => key.KeyType === 'HASH')?.AttributeName;
    const hasEmailIndex = existing.Table?.GlobalSecondaryIndexes?.some(
      (index) => index.IndexName === 'EmailIndex'
    );

    if (hasEmailIndex) {
      console.log(`[identity] ${table.name} exists; PK=${existingKey || 'unknown'}, EmailIndex=yes`);
      return;
    }

    if (existingKey !== table.partitionKey) {
      throw new Error(
        `${table.name} has PK=${existingKey || 'unknown'}, expected ${table.partitionKey}; refusing schema change`,
      );
    }

    await dynamoClient.send(new UpdateTableCommand({
      TableName: table.name,
      AttributeDefinitions: [
        { AttributeName: table.partitionKey, AttributeType: 'S' },
        { AttributeName: 'email', AttributeType: 'S' },
      ],
      GlobalSecondaryIndexUpdates: [{
        Create: {
          IndexName: 'EmailIndex',
          KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
      }],
    }));
    console.log(`[identity] ${table.name} existed without EmailIndex; repair started`);
    return;
  } catch (error) {
    if (error.name !== 'ResourceNotFoundException') throw error;
  }

  await dynamoClient.send(new CreateTableCommand(createTableInput(table)));
  console.log(`[identity] created ${table.name} with PAY_PER_REQUEST billing`);
}

async function main() {
  console.log(`[identity] AWS region: ${REGION}`);
  for (const table of IDENTITY_TABLES) {
    await ensureTable(table);
  }
  console.log('[identity] done');
}

main().catch((error) => {
  console.error('[identity] failed:', error.message);
  process.exitCode = 1;
});