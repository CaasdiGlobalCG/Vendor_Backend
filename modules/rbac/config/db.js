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

// Use the default credential provider chain (reads env vars lazily at request
// time). Passing explicit { accessKeyId, secretAccessKey } here would freeze
// the values at module-load time — if this module is imported before server.js
// runs dotenv.config(), both values are undefined and every call fails silently.
const dynamoClient = new DynamoDBClient({ region });

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
