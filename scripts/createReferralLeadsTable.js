import AWS from 'aws-sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
  
});

const dynamodb = new AWS.DynamoDB();

const TABLE_NAME = process.env.REFERRAL_LEADS_TABLE || 'referral_leads';

const createReferralLeadsTable = async () => {
  const params = {
    TableName: TABLE_NAME,
    KeySchema: [
      { AttributeName: 'referrerVendorId', KeyType: 'HASH' },
      { AttributeName: 'createdAt', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'referrerVendorId', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
      { AttributeName: 'leadId', AttributeType: 'S' },
      { AttributeName: 'status', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'LeadIdIndex',
        KeySchema: [{ AttributeName: 'leadId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
      },
      {
        IndexName: 'StatusIndex',
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
  };

  try {
    console.log(`🚀 Creating table: ${TABLE_NAME}...`);
    await dynamodb.createTable(params).promise();
    console.log('✅ referral_leads table created successfully');

    await dynamodb.waitFor('tableExists', { TableName: TABLE_NAME }).promise();
    console.log('✅ referral_leads table is now active');

    return true;
  } catch (error) {
    if (error.code === 'ResourceInUseException') {
      console.log('ℹ️ Table already exists');
      return true;
    }
    console.error('❌ Error creating referral_leads table:', error);
    return false;
  }
};

createReferralLeadsTable().then((ok) => {
  process.exit(ok ? 0 : 1);
});
