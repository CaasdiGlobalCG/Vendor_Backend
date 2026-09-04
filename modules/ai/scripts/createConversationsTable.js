// ============================================================
// Script: Create the ai_conversations DynamoDB table
// Run:    node modules/ai/scripts/createConversationsTable.js
// ============================================================

import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });

const TABLE_NAME = process.env.AI_CONVERSATIONS_TABLE || 'ai_conversations';

async function createTable() {
  // Check if table already exists
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    console.log(`✅ Table "${TABLE_NAME}" already exists.`);
    return;
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
  }

  const params = {
    TableName: TABLE_NAME,
    KeySchema: [
      { AttributeName: 'conversationId', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'conversationId', AttributeType: 'S' },
      { AttributeName: 'vendorId', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'vendorId-index',
        KeySchema: [
          { AttributeName: 'vendorId', KeyType: 'HASH' },
          { AttributeName: 'conversationId', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      },
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
    TimeToLiveSpecification: {
      AttributeName: 'ttl',
      Enabled: true,
    },
  };

  try {
    await client.send(new CreateTableCommand(params));
    console.log(`✅ Table "${TABLE_NAME}" created successfully.`);
    console.log('   - Partition key: conversationId (String)');
    console.log('   - GSI: vendorId-index (vendorId HASH, conversationId RANGE)');
    console.log('   - TTL: enabled on "ttl" attribute');
  } catch (err) {
    console.error(`❌ Failed to create table: ${err.message}`);
    process.exit(1);
  }
}

createTable();
