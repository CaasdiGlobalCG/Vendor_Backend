// ============================================================
// FILE: db.js
// PURPOSE: AWS SDK v3 DynamoDB client for all RBAC operations.
//          Shared across middleware, services, and scripts.
// CONNECTS TO: Every RBAC service and middleware that touches DynamoDB
// ============================================================

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve .env relative to Vendor_Backend root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const region = process.env.AWS_REGION || 'us-east-1';

const dynamoClient = new DynamoDBClient({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * DynamoDB Document Client (v3) for RBAC operations.
 * Uses marshallOptions to auto-remove undefined values and convert empty strings.
 */
export const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});

export { dynamoClient };
