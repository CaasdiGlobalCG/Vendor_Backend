import AWS from 'aws-sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { VENDORS_TABLE, GOOGLE_USERS_TABLE, WORKSPACES_TABLE, ACTIVITIES_TABLE, PM_PROJECTS_TABLE, WORKSPACE_MESSAGES_TABLE, POST_SERVICES_TABLE, POST_SERVICES_NOTIFICATIONS_TABLE } from '../config/aws.js';

// Define the leads table name
const LEADS_TABLE = 'leads';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file in the parent directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

console.log('AWS Credentials:');
console.log('Region:', process.env.AWS_REGION);
console.log('Access Key ID:', process.env.AWS_ACCESS_KEY_ID ? 'Found' : 'Missing');
console.log('Secret Access Key:', process.env.AWS_SECRET_ACCESS_KEY ? 'Found' : 'Missing');

// Configure AWS SDK
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('AWS credentials are missing in the .env file!');
  process.exit(1);
}

AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  // Disable credential loading from EC2 metadata service
  httpOptions: {
    timeout: 5000,
    connectTimeout: 5000
  }
});

// Create DynamoDB service object
const dynamodb = new AWS.DynamoDB();

// Create vendors table if it doesn't exist
const createVendorsTable = async () => {
  const params = {
    TableName: VENDORS_TABLE,
    KeySchema: [
      { AttributeName: 'vendorId', KeyType: 'HASH' }  // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: 'vendorId', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    // Check if table exists
    try {
      await dynamodb.describeTable({ TableName: VENDORS_TABLE }).promise();
      console.log(`Table ${VENDORS_TABLE} already exists`);
    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        // Create table if it doesn't exist
        await dynamodb.createTable(params).promise();
        console.log(`Created table ${VENDORS_TABLE}`);
        
        // Wait for table to be created
        console.log('Waiting for table to be active...');
        await dynamodb.waitFor('tableExists', { TableName: VENDORS_TABLE }).promise();
        console.log('Table is now active');
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Error creating vendors table:', error);
    throw error;
  }
};

// Create Google users table if it doesn't exist
const createGoogleUsersTable = async () => {
  const params = {
    TableName: GOOGLE_USERS_TABLE,
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' }  // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    // Check if table exists
    try {
      await dynamodb.describeTable({ TableName: GOOGLE_USERS_TABLE }).promise();
      console.log(`Table ${GOOGLE_USERS_TABLE} already exists`);
    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        // Create table if it doesn't exist
        await dynamodb.createTable(params).promise();
        console.log(`Created table ${GOOGLE_USERS_TABLE}`);
        
        // Wait for table to be created
        console.log('Waiting for table to be active...');
        await dynamodb.waitFor('tableExists', { TableName: GOOGLE_USERS_TABLE }).promise();
        console.log('Table is now active');
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Error creating Google users table:', error);
    throw error;
  }
};

// Create leads table if it doesn't exist
const createLeadsTable = async () => {
  const params = {
    TableName: LEADS_TABLE,
    KeySchema: [
      { AttributeName: 'leadId', KeyType: 'HASH' }  // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: 'leadId', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    // Check if table exists
    try {
      await dynamodb.describeTable({ TableName: LEADS_TABLE }).promise();
      console.log(`Table ${LEADS_TABLE} already exists`);
    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        // Create table if it doesn't exist
        await dynamodb.createTable(params).promise();
        console.log(`Created table ${LEADS_TABLE}`);
        
        // Wait for table to be created
        console.log('Waiting for table to be active...');
        await dynamodb.waitFor('tableExists', { TableName: LEADS_TABLE }).promise();
        console.log('Table is now active');
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Error creating leads table:', error);
    throw error;
  }
};

// Create workspaces table if it doesn't exist
const createWorkspacesTable = async () => {
  const params = {
    TableName: WORKSPACES_TABLE,
    KeySchema: [
      { AttributeName: 'workspaceId', KeyType: 'HASH' }  // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: 'workspaceId', AttributeType: 'S' }
    ],
    BillingMode: 'PAY_PER_REQUEST' // Use on-demand billing
  };

  try {
    // Check if table exists
    try {
      await dynamodb.describeTable({ TableName: WORKSPACES_TABLE }).promise();
      console.log(`Table ${WORKSPACES_TABLE} already exists`);
    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        // Create table if it doesn't exist
        await dynamodb.createTable(params).promise();
        console.log(`Created table ${WORKSPACES_TABLE}`);
        
        // Wait for table to be created
        console.log('Waiting for table to be active...');
        await dynamodb.waitFor('tableExists', { TableName: WORKSPACES_TABLE }).promise();
        console.log('Table is now active');
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Error creating workspaces table:', error);
    throw error;
  }
};

// Create all tables
// Create Activities table
const createActivitiesTable = async () => {
  const params = {
    TableName: ACTIVITIES_TABLE,
    KeySchema: [
      { AttributeName: 'activityId', KeyType: 'HASH' } // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: 'activityId', AttributeType: 'S' },
      { AttributeName: 'workspaceId', AttributeType: 'S' },
      { AttributeName: 'timestamp', AttributeType: 'S' },
      { AttributeName: 'date', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'WorkspaceIndex',
        KeySchema: [
          { AttributeName: 'workspaceId', KeyType: 'HASH' },
          { AttributeName: 'timestamp', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      },
      {
        IndexName: 'DateIndex',
        KeySchema: [
          { AttributeName: 'workspaceId', KeyType: 'HASH' },
          { AttributeName: 'date', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      },
      {
        IndexName: 'UserIndex',
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'timestamp', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    const result = await dynamodb.createTable(params).promise();
    console.log('✅ Activities table created successfully:', result.TableDescription.TableName);
  } catch (error) {
    if (error.code === 'ResourceInUseException') {
      console.log('⚠️ Activities table already exists');
    } else {
      console.error('❌ Error creating Activities table:', error);
      throw error;
    }
  }
};

// Create PM Projects table
const createPMProjectsTable = async () => {
  const params = {
    TableName: PM_PROJECTS_TABLE,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' } // Primary key
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'vendorId', AttributeType: 'S' },
      { AttributeName: 'clientId', AttributeType: 'S' },
      { AttributeName: 'leadId', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'VendorIndex',
        KeySchema: [
          { AttributeName: 'vendorId', KeyType: 'HASH' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      },
      {
        IndexName: 'ClientIndex',
        KeySchema: [
          { AttributeName: 'clientId', KeyType: 'HASH' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      },
      {
        IndexName: 'LeadIndex',
        KeySchema: [
          { AttributeName: 'leadId', KeyType: 'HASH' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      }
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
  };

  try {
    // Check if table already exists
    try {
      await dynamodb.describeTable({ TableName: PM_PROJECTS_TABLE }).promise();
      console.log(`Table ${PM_PROJECTS_TABLE} already exists`);
      return;
    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        console.log(`Creating table ${PM_PROJECTS_TABLE}...`);
        await dynamodb.createTable(params).promise();
        
        // Wait for table to be active
        await dynamodb.waitFor('tableExists', { TableName: PM_PROJECTS_TABLE }).promise();
        console.log(`Table ${PM_PROJECTS_TABLE} is now active`);
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error(`Error creating ${PM_PROJECTS_TABLE} table:`, error);
    throw error;
  }
};

// Create Workspace Messages table
const createWorkspaceMessagesTable = async () => {
  const params = {
    TableName: WORKSPACE_MESSAGES_TABLE,
    KeySchema: [
      { AttributeName: 'messageId', KeyType: 'HASH' } // Primary key
    ],
    AttributeDefinitions: [
      { AttributeName: 'messageId', AttributeType: 'S' },
      { AttributeName: 'workspaceId', AttributeType: 'S' },
      { AttributeName: 'timestamp', AttributeType: 'S' },
      { AttributeName: 'senderId', AttributeType: 'S' },
      { AttributeName: 'date', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'WorkspaceIndex',
        KeySchema: [
          { AttributeName: 'workspaceId', KeyType: 'HASH' },
          { AttributeName: 'timestamp', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      },
      {
        IndexName: 'SenderIndex',
        KeySchema: [
          { AttributeName: 'senderId', KeyType: 'HASH' },
          { AttributeName: 'timestamp', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      },
      {
        IndexName: 'DateIndex',
        KeySchema: [
          { AttributeName: 'date', KeyType: 'HASH' },
          { AttributeName: 'timestamp', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      }
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
  };

  try {
    // Check if table already exists
    try {
      await dynamodb.describeTable({ TableName: WORKSPACE_MESSAGES_TABLE }).promise();
      console.log(`Table ${WORKSPACE_MESSAGES_TABLE} already exists`);
      return;
    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        console.log(`Creating table ${WORKSPACE_MESSAGES_TABLE}...`);
        await dynamodb.createTable(params).promise();
        
        // Wait for table to be active
        await dynamodb.waitFor('tableExists', { TableName: WORKSPACE_MESSAGES_TABLE }).promise();
        console.log(`Table ${WORKSPACE_MESSAGES_TABLE} is now active`);
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error(`Error creating ${WORKSPACE_MESSAGES_TABLE} table:`, error);
    throw error;
  }
};

// Create Post Services table
const createPostServicesTable = async () => {
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
    // Check if table exists
    try {
      await dynamodb.describeTable({ TableName: POST_SERVICES_TABLE }).promise();
      console.log(`Table ${POST_SERVICES_TABLE} already exists`);
      return;
    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        console.log(`Creating table ${POST_SERVICES_TABLE}...`);
        await dynamodb.createTable(params).promise();
        
        // Wait for table to be active
        await dynamodb.waitFor('tableExists', { TableName: POST_SERVICES_TABLE }).promise();
        console.log(`Table ${POST_SERVICES_TABLE} is now active`);
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error(`Error creating ${POST_SERVICES_TABLE} table:`, error);
    throw error;
  }
};

// Create Post Services Notifications table
const createPostServicesNotificationsTable = async () => {
  const params = {
    TableName: POST_SERVICES_NOTIFICATIONS_TABLE,
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' },  // Partition key
      { AttributeName: 'createdAt', KeyType: 'RANGE' }   // Sort key
    ],
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
      { AttributeName: 'isRead', AttributeType: 'BOOL' } // For filtering unread notifications
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
    // Check if table exists
    try {
      await dynamodb.describeTable({ TableName: POST_SERVICES_NOTIFICATIONS_TABLE }).promise();
      console.log(`Table ${POST_SERVICES_NOTIFICATIONS_TABLE} already exists`);
      return;
    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        console.log(`Creating table ${POST_SERVICES_NOTIFICATIONS_TABLE}...`);
        await dynamodb.createTable(params).promise();
        
        // Wait for table to be active
        await dynamodb.waitFor('tableExists', { TableName: POST_SERVICES_NOTIFICATIONS_TABLE }).promise();
        console.log(`Table ${POST_SERVICES_NOTIFICATIONS_TABLE} is now active`);
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error(`Error creating ${POST_SERVICES_NOTIFICATIONS_TABLE} table:`, error);
    throw error;
  }
};

const createTables = async () => {
  try {
    await createVendorsTable();
    await createGoogleUsersTable();
    await createLeadsTable();
    await createWorkspacesTable();
    await createActivitiesTable();
    await createPMProjectsTable();
    await createWorkspaceMessagesTable();
    await createPostServicesTable();
    await createPostServicesNotificationsTable();
    console.log('All tables created successfully');
  } catch (error) {
    console.error('Error creating tables:', error);
  }
};

// Run the script
createTables();