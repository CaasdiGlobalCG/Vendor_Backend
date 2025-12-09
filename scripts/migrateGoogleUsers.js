import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import GoogleUser from '../models/GoogleUser.js';
import * as DynamoGoogleUser from '../models/DynamoGoogleUser.js';
import AWS from 'aws-sdk';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file in the parent directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

console.log('AWS Credentials:');
console.log('Region:', process.env.AWS_REGION);
console.log('Access Key ID:', process.env.AWS_ACCESS_KEY_ID ? 'Found' : 'Missing');
console.log('Secret Access Key:', process.env.AWS_SECRET_ACCESS_KEY ? 'Found' : 'Missing');
console.log('MongoDB URI:', process.env.MONGO_URI ? 'Found' : 'Missing');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
  migrateUsers();
}).catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

// Create DynamoDB table if it doesn't exist
const createDynamoDBTable = async () => {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('AWS credentials are missing in the .env file!');
    process.exit(1);
  }
  
  const dynamodb = new AWS.DynamoDB({
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    // Disable credential loading from EC2 metadata service
    httpOptions: {
      timeout: 5000,
      connectTimeout: 5000
    }
  });

  const params = {
    TableName: DynamoGoogleUser.GOOGLE_USERS_TABLE,
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
      await dynamodb.describeTable({ TableName: DynamoGoogleUser.GOOGLE_USERS_TABLE }).promise();
      console.log(`Table ${DynamoGoogleUser.GOOGLE_USERS_TABLE} already exists`);
    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        // Create table if it doesn't exist
        await dynamodb.createTable(params).promise();
        console.log(`Created table ${DynamoGoogleUser.GOOGLE_USERS_TABLE}`);
        
        // Wait for table to be created
        console.log('Waiting for table to be active...');
        await dynamodb.waitFor('tableExists', { TableName: DynamoGoogleUser.GOOGLE_USERS_TABLE }).promise();
        console.log('Table is now active');
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Error creating DynamoDB table:', error);
    throw error;
  }
};

// Migrate users from MongoDB to DynamoDB
const migrateUsers = async () => {
  try {
    // Create DynamoDB table if it doesn't exist
    await createDynamoDBTable();
    
    // Get all Google users from MongoDB
    const mongoUsers = await GoogleUser.find({});
    console.log(`Found ${mongoUsers.length} Google users in MongoDB`);
    
    // Migrate each user to DynamoDB
    let successCount = 0;
    let errorCount = 0;
    
    for (const user of mongoUsers) {
      try {
        // Check if user already exists in DynamoDB
        const existingUser = await DynamoGoogleUser.getGoogleUserByGoogleId(user.googleId);
        
        if (existingUser) {
          console.log(`User with googleId ${user.googleId} already exists in DynamoDB, skipping`);
          continue;
        }
        
        // Create user in DynamoDB
        const userData = {
          googleId: user.googleId,
          cognitoId: user.cognitoId || null,
          displayName: user.displayName || '',
          email: user.email,
          role: user.role || 'vendor'
        };
        
        await DynamoGoogleUser.createGoogleUser(userData);
        console.log(`Migrated user: ${user.email}`);
        successCount++;
      } catch (error) {
        console.error(`Error migrating user ${user.email}:`, error);
        errorCount++;
      }
    }
    
    console.log(`Migration complete. Successfully migrated ${successCount} users. Failed: ${errorCount}`);
    
    // Verify migration
    const dynamoUsers = await DynamoGoogleUser.getAllGoogleUsers();
    console.log(`Total users in DynamoDB after migration: ${dynamoUsers.length}`);
    
    // Close MongoDB connection
    mongoose.connection.close();
    console.log('MongoDB connection closed');
    
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
};