import AWS from 'aws-sdk';
import dotenv from 'dotenv';

dotenv.config();

AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  httpOptions: {
    timeout: 8000,
    connectTimeout: 8000
  }
});

const dynamodb = new AWS.DynamoDB();
const WORKFLOWS_TABLE = 'workflows_table';

const createWorkflowsTable = async () => {
  const params = {
    TableName: WORKFLOWS_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: [
      { AttributeName: 'workflowId', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'workflowId', AttributeType: 'S' },
      { AttributeName: 'workspaceId', AttributeType: 'S' },
      { AttributeName: 'updatedAt', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'workspaceId-updatedAt-index',
        KeySchema: [
          { AttributeName: 'workspaceId', KeyType: 'HASH' },
          { AttributeName: 'updatedAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' }
      }
    ]
  };

  try {
    await dynamodb.describeTable({ TableName: WORKFLOWS_TABLE }).promise();
    console.log(`Table already exists: ${WORKFLOWS_TABLE}`);
    return;
  } catch (error) {
    if (error.code !== 'ResourceNotFoundException') {
      throw error;
    }
  }

  await dynamodb.createTable(params).promise();
  console.log(`Created table: ${WORKFLOWS_TABLE}`);

  await dynamodb.waitFor('tableExists', { TableName: WORKFLOWS_TABLE }).promise();
  console.log(`Table is active: ${WORKFLOWS_TABLE}`);
};

const run = async () => {
  try {
    console.log('Creating workflows_table...');
    await createWorkflowsTable();
    console.log('Done.');
    process.exit(0);
  } catch (error) {
    console.error('Failed to create workflows_table:', error.message);
    process.exit(1);
  }
};

run();
