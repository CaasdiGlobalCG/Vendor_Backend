import AWS from 'aws-sdk';
import dotenv from 'dotenv';

dotenv.config();

const dynamodb = new AWS.DynamoDB({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const createAssetsTable = async () => {
  const params = {
    TableName: 'Assets',
    KeySchema: [
      { AttributeName: 'workspaceId', KeyType: 'HASH' },
      { AttributeName: 'assetId', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'workspaceId', AttributeType: 'S' },
      { AttributeName: 'assetId', AttributeType: 'S' },
      { AttributeName: 'subtaskId', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'subtaskIdIndex',
        KeySchema: [
          { AttributeName: 'subtaskId', KeyType: 'HASH' },
          { AttributeName: 'assetId', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' }
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  };

  try {
    const result = await dynamodb.createTable(params).promise();
    console.log('✅ Assets table created successfully:', result.TableDescription.TableName);
  } catch (error) {
    if (error.code === 'ResourceInUseException') {
      console.log('✅ Assets table already exists');
    } else {
      console.error('❌ Error creating Assets table:', error);
    }
  }
};

createAssetsTable();
