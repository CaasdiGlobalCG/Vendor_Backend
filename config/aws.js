import AWS from 'aws-sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

console.log('AWS Configuration:');
console.log('Region:', process.env.AWS_REGION || 'us-east-1');
console.log('Access Key ID:', process.env.AWS_ACCESS_KEY_ID ? 'Set (hidden)' : 'Not set');
console.log('Secret Access Key:', process.env.AWS_SECRET_ACCESS_KEY ? 'Set (hidden)' : 'Not set');

// Configure AWS SDK
AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

// Create DynamoDB client
const dynamoDB = new AWS.DynamoDB.DocumentClient();

// Create S3 client
const s3 = new AWS.S3();

// S3 bucket names
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'mac-vendor-uploads';
const MESSAGE_UPLOADS_BUCKET = 'uploads-in-messages';
const WORKSPACE_UPLOADS_BUCKET = 'workspace--uploads';

// Table names
const VENDORS_TABLE = 'vendors';
const GOOGLE_USERS_TABLE = 'google_users';
const LEADS_TABLE = 'leads';
const PROJECTS_TABLE = 'projects';
const PM_PROJECTS_TABLE = 'pm_projects';
const USERS_TABLE = 'users';
// Use workspaces_table for all workspace operations
const WORKSPACES_TABLE = 'workspaces_table';
const ACTIVITIES_TABLE = 'workspace_activities';
const WORKSPACE_MESSAGES_TABLE = 'workspace_messages';
const POST_SERVICES_TABLE = 'post_services_table'; // New table for Post Services
const POST_SERVICES_NOTIFICATIONS_TABLE = 'post_services_notifications_table'; // New table for Post Services Notifications

// KMS Configuration
const KMS_KEY_ID = 'arn:aws:kms:us-east-1:286757679229:key/65ed0dd6-c62d-4bd6-ae7e-e27bb7c115f8';

// Initialize KMS client
const kms = new AWS.KMS({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

export { dynamoDB, s3, kms, VENDORS_TABLE, GOOGLE_USERS_TABLE, LEADS_TABLE, PROJECTS_TABLE, PM_PROJECTS_TABLE,USERS_TABLE, WORKSPACES_TABLE, ACTIVITIES_TABLE, WORKSPACE_MESSAGES_TABLE, POST_SERVICES_TABLE, POST_SERVICES_NOTIFICATIONS_TABLE, S3_BUCKET_NAME, MESSAGE_UPLOADS_BUCKET, WORKSPACE_UPLOADS_BUCKET, KMS_KEY_ID };