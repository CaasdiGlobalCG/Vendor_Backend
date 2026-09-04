import AWS from 'aws-sdk';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// Configure AWS SDK (same as existing system)
AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
  
});

const dynamodb = new AWS.DynamoDB();
const docClient = new AWS.DynamoDB.DocumentClient();

const PM_USERS_TABLE = 'pm_users_table';

// Create PM Users Table
const createPMUsersTable = async () => {
  const params = {
    TableName: PM_USERS_TABLE,
    KeySchema: [
      { AttributeName: 'pmId', KeyType: 'HASH' } // Primary key
    ],
    AttributeDefinitions: [
      { AttributeName: 'pmId', AttributeType: 'S' },
      { AttributeName: 'email', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'EmailIndex',
        KeySchema: [
          { AttributeName: 'email', KeyType: 'HASH' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: {
          ReadCapacityUnits: 1,
          WriteCapacityUnits: 1
        }
      }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 1,
      WriteCapacityUnits: 1
    }
  };

  try {
    console.log('🚀 Creating PM Users table...');
    await dynamodb.createTable(params).promise();
    console.log('✅ PM Users table created successfully');
    
    // Wait for table to be active
    await dynamodb.waitFor('tableExists', { TableName: PM_USERS_TABLE }).promise();
    console.log('✅ PM Users table is now active');
    
    return true;
  } catch (error) {
    if (error.code === 'ResourceInUseException') {
      console.log('ℹ️ PM Users table already exists');
      return true;
    }
    console.error('❌ Error creating PM Users table:', error);
    return false;
  }
};

// Create Sample PM Users
const createSamplePMUsers = async () => {
  const samplePMs = [
    {
      pmId: 'PM-001',
      email: 'pm@construction.com',
      name: 'John Smith',
      company: 'ABC Construction',
      specialization: 'Construction Projects',
      password: 'pm123', // Will be hashed
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLogin: null,
      projectsCount: 0,
      totalBudgetManaged: 0
    },
    {
      pmId: 'PM-002', 
      email: 'sarah@engineering.com',
      name: 'Sarah Johnson',
      company: 'Engineering Solutions',
      specialization: 'Engineering Projects',
      password: 'pm123', // Will be hashed
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLogin: null,
      projectsCount: 0,
      totalBudgetManaged: 0
    },
    {
      pmId: 'PM-003',
      email: 'mike@infrastructure.com', 
      name: 'Mike Wilson',
      company: 'Infrastructure Corp',
      specialization: 'Infrastructure Development',
      password: 'pm123', // Will be hashed
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLogin: null,
      projectsCount: 0,
      totalBudgetManaged: 0
    }
  ];

  console.log('🚀 Creating sample PM users...');
  
  for (const pm of samplePMs) {
    try {
      // Hash password
      const hashedPassword = await bcrypt.hash(pm.password, 10);
      
      const pmData = {
        ...pm,
        hashedPassword,
        // Remove plain password
        password: undefined
      };
      delete pmData.password;

      await docClient.put({
        TableName: PM_USERS_TABLE,
        Item: pmData,
        ConditionExpression: 'attribute_not_exists(pmId)' // Don't overwrite existing
      }).promise();

      console.log(`✅ Created PM user: ${pm.name} (${pm.email})`);
    } catch (error) {
      if (error.code === 'ConditionalCheckFailedException') {
        console.log(`ℹ️ PM user already exists: ${pm.name} (${pm.email})`);
      } else {
        console.error(`❌ Error creating PM user ${pm.name}:`, error);
      }
    }
  }
};

// Main execution
const setupPMUsersTable = async () => {
  console.log('🎯 Setting up PM Users Table and Sample Data...\n');
  
  try {
    // Create table
    const tableCreated = await createPMUsersTable();
    
    if (tableCreated) {
      // Create sample users
      await createSamplePMUsers();
      
      console.log('\n🎉 PM Users setup completed successfully!');
      console.log('\n📋 Sample PM Accounts Created:');
      console.log('1. pm@construction.com / pm123 (John Smith - ABC Construction)');
      console.log('2. sarah@engineering.com / pm123 (Sarah Johnson - Engineering Solutions)');
      console.log('3. mike@infrastructure.com / pm123 (Mike Wilson - Infrastructure Corp)');
      console.log('\n🔗 Table Name: pm_users_table');
      console.log('🔑 Primary Key: pmId');
      console.log('📧 GSI: EmailIndex (for login by email)');
    }
  } catch (error) {
    console.error('❌ Setup failed:', error);
  }
};

// Run the setup
setupPMUsersTable();
