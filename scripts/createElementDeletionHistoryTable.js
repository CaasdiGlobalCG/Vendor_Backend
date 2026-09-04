import AWS from 'aws-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Configure AWS SDK
AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
  
});

const dynamoDB = new AWS.DynamoDB();

const createElementDeletionHistoryTable = async () => {
  const params = {
    TableName: 'element_deletion_history',
    KeySchema: [
      {
        AttributeName: 'deletionId',
        KeyType: 'HASH' // Partition key
      }
    ],
    AttributeDefinitions: [
      {
        AttributeName: 'deletionId',
        AttributeType: 'S'
      },
      {
        AttributeName: 'workspaceId_timestamp',
        AttributeType: 'S'
      },
      {
        AttributeName: 'workspaceId',
        AttributeType: 'S'
      },
      {
        AttributeName: 'elementId',
        AttributeType: 'S'
      },
      {
        AttributeName: 'deletedByEmail',
        AttributeType: 'S'
      }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'WorkspaceIdIndex',
        KeySchema: [
          {
            AttributeName: 'workspaceId',
            KeyType: 'HASH'
          },
          {
            AttributeName: 'workspaceId_timestamp',
            KeyType: 'RANGE'
          }
        ],
        Projection: {
          ProjectionType: 'ALL'
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      },
      {
        IndexName: 'ElementIdIndex',
        KeySchema: [
          {
            AttributeName: 'elementId',
            KeyType: 'HASH'
          }
        ],
        Projection: {
          ProjectionType: 'ALL'
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      },
      {
        IndexName: 'DeletedByEmailIndex',
        KeySchema: [
          {
            AttributeName: 'deletedByEmail',
            KeyType: 'HASH'
          }
        ],
        Projection: {
          ProjectionType: 'ALL'
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      }
    ],
    StreamSpecification: {
      StreamViewType: 'NEW_AND_OLD_IMAGES',
      StreamEnabled: true
    },
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    console.log('🔧 Creating element_deletion_history table...');
    
    // Check if table already exists
    try {
      await dynamoDB.describeTable({ TableName: 'element_deletion_history' }).promise();
      console.log('✅ element_deletion_history table already exists');
      return;
    } catch (error) {
      if (error.code !== 'ResourceNotFoundException') {
        throw error;
      }
    }

    // Create the table
    const result = await dynamoDB.createTable(params).promise();
    console.log('✅ element_deletion_history table created successfully:', result.TableDescription.TableName);

    // Wait for table to be active
    console.log('⏳ Waiting for table to be active...');
    await dynamoDB.waitFor('tableExists', { TableName: 'element_deletion_history' }).promise();
    console.log('✅ element_deletion_history table is now active');

    console.log('\n📋 Table Configuration:');
    console.log('  - Partition Key: deletionId (String)');
    console.log('  - Global Secondary Indexes:');
    console.log('    1. WorkspaceIdIndex (workspaceId + workspaceId_timestamp)');
    console.log('    2. ElementIdIndex (elementId)');
    console.log('    3. DeletedByEmailIndex (deletedByEmail)');
    console.log('  - TTL: Enabled (90 days for automatic cleanup)');
    console.log('  - Stream: Enabled (NEW_AND_OLD_IMAGES)');

  } catch (error) {
    console.error('❌ Error creating element_deletion_history table:', error);
    throw error;
  }
};

// Enable TTL for automatic cleanup
const enableTTL = async () => {
  const params = {
    TableName: 'element_deletion_history',
    TimeToLiveSpecification: {
      AttributeName: 'TTL',
      Enabled: true
    }
  };

  try {
    console.log('\n🕐 Enabling TTL for automatic cleanup...');
    await dynamoDB.updateTimeToLive(params).promise();
    console.log('✅ TTL enabled for element_deletion_history table (90-day retention)');
  } catch (error) {
    if (error.code === 'ValidationException' && error.message.includes('TimeToLive')) {
      console.log('ℹ️ TTL already enabled or being updated');
    } else {
      console.error('❌ Error enabling TTL:', error);
    }
  }
};

(async () => {
  try {
    console.log('🚀 Setting up Element Deletion History Table...\n');
    await createElementDeletionHistoryTable();
    await enableTTL();
    console.log('\n🎉 Element Deletion History table setup completed successfully!');
  } catch (error) {
    console.error('💥 Failed to setup element deletion history table:', error);
    process.exit(1);
  }
})();
