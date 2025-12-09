import dotenv from 'dotenv';
dotenv.config();

import AWS from 'aws-sdk';

// Configure AWS
AWS.config.update({
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const dynamodb = new AWS.DynamoDB();

// Table names
const POST_SERVICES_TABLE = 'post_services_table';
const POST_SERVICES_NOTIFICATIONS_TABLE = 'post_services_notifications_table';

/**
 * Check if a table exists
 */
async function checkTableExists(tableName) {
  try {
    await dynamodb.describeTable({ TableName: tableName }).promise();
    console.log(`✅ Table ${tableName} already exists.`);
    return true;
  } catch (err) {
    if (err.code === 'ResourceNotFoundException') {
      console.log(`❌ Table ${tableName} does not exist.`);
      return false;
    }
    throw err;
  }
}

/**
 * Create the post_services_table
 */
async function createPostServicesTable() {
  const params = {
    TableName: POST_SERVICES_TABLE,
    KeySchema: [
      { AttributeName: 'workspaceId', KeyType: 'HASH' },  // Partition key
      { AttributeName: 'createdAt', KeyType: 'RANGE' }   // Sort key
    ],
    AttributeDefinitions: [
      { AttributeName: 'workspaceId', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
      { AttributeName: 'senderId', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'SenderIndex',
        KeySchema: [
          { AttributeName: 'senderId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    console.log(`🔄 Creating table ${POST_SERVICES_TABLE}...`);
    const result = await dynamodb.createTable(params).promise();
    console.log(`✅ Table ${POST_SERVICES_TABLE} created successfully:`, result.TableDescription.TableStatus);
    return result;
  } catch (err) {
    console.error(`❌ Error creating table ${POST_SERVICES_TABLE}:`, err);
    throw err;
  }
}

/**
 * Create the post_services_notifications_table
 */
async function createPostServicesNotificationsTable() {
  const params = {
    TableName: POST_SERVICES_NOTIFICATIONS_TABLE,
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' },      // Partition key
      { AttributeName: 'createdAt', KeyType: 'RANGE' }   // Sort key
    ],
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
      { AttributeName: 'isRead', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'UnreadNotificationsIndex',
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'isRead', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    console.log(`🔄 Creating table ${POST_SERVICES_NOTIFICATIONS_TABLE}...`);
    const result = await dynamodb.createTable(params).promise();
    console.log(`✅ Table ${POST_SERVICES_NOTIFICATIONS_TABLE} created successfully:`, result.TableDescription.TableStatus);
    return result;
  } catch (err) {
    console.error(`❌ Error creating table ${POST_SERVICES_NOTIFICATIONS_TABLE}:`, err);
    throw err;
  }
}

/**
 * Wait for table to become active
 */
async function waitForTableActive(tableName) {
  try {
    console.log(`⏳ Waiting for table ${tableName} to become active...`);
    await dynamodb.waitFor('tableExists', { TableName: tableName }).promise();
    console.log(`✅ Table ${tableName} is now active and ready to use.`);
  } catch (err) {
    console.error(`❌ Error waiting for table ${tableName} to become active:`, err);
    throw err;
  }
}

/**
 * Main function to create both tables
 */
async function createTables() {
  try {
    console.log('🚀 Starting Post Services tables creation...\n');

    // Create post_services_table
    const postServicesExists = await checkTableExists(POST_SERVICES_TABLE);
    if (!postServicesExists) {
      await createPostServicesTable();
      await waitForTableActive(POST_SERVICES_TABLE);
    }

    console.log(''); // Empty line for better readability

    // Create post_services_notifications_table
    const notificationsExists = await checkTableExists(POST_SERVICES_NOTIFICATIONS_TABLE);
    if (!notificationsExists) {
      await createPostServicesNotificationsTable();
      await waitForTableActive(POST_SERVICES_NOTIFICATIONS_TABLE);
    }

    console.log('\n🎉 All Post Services tables created successfully!');
    console.log('\n📋 Table Summary:');
    console.log(`   • ${POST_SERVICES_TABLE}: Stores service requests with mentions, hashtags, and attachments`);
    console.log(`   • ${POST_SERVICES_NOTIFICATIONS_TABLE}: Manages real-time notifications for mentions and hashtags`);
    
    console.log('\n🔍 Table Details:');
    console.log(`\n   ${POST_SERVICES_TABLE}:`);
    console.log('   - Primary Key: workspaceId (PK), createdAt (SK)');
    console.log('   - GSI: SenderIndex (senderId PK, createdAt SK)');
    console.log('   - Attributes: postId, senderId, senderName, senderEmail, senderRole, content, attachments, mentions, hashtags, status, priority, comments');
    
    console.log(`\n   ${POST_SERVICES_NOTIFICATIONS_TABLE}:`);
    console.log('   - Primary Key: userId (PK), createdAt (SK)');
    console.log('   - GSI: UnreadNotificationsIndex (userId PK, isRead SK)');
    console.log('   - Attributes: notificationId, senderId, senderName, type, message, postId, link, isRead');

  } catch (error) {
    console.error('❌ Error creating tables:', error);
    process.exit(1);
  }
}

// Run the script
createTables()
  .then(() => {
    console.log('\n✅ Script completed successfully!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Script failed:', err);
    process.exit(1);
  });
