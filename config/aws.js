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
console.log('Region:', process.env.AWS_REGION || 'ap-south-1');
console.log('Access Key ID:', process.env.AWS_ACCESS_KEY_ID ? 'Set (hidden)' : 'Not set');
console.log('Secret Access Key:', process.env.AWS_SECRET_ACCESS_KEY ? 'Set (hidden)' : 'Not set');

// Configure AWS SDK. Set credentials explicitly because SDK v2 can otherwise
// resolve a different shared-profile credential before dotenv is loaded.
const awsConfig = {
  region: process.env.AWS_REGION || 'ap-south-1',
};
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  awsConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}
AWS.config.update(awsConfig);

// Create DynamoDB client
const dynamoDB = new AWS.DynamoDB.DocumentClient();

// Create S3 client
const s3 = new AWS.S3();

// S3 bucket names
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'mac-vendor-uploads-025775692918';
const MESSAGE_UPLOADS_BUCKET = 'uploads-in-messages-025775692918';
const WORKSPACE_UPLOADS_BUCKET = 'workspace-table-025775692918';

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
const WORKFLOWS_TABLE = 'workflows_table'; // Workflows table
const PHYSICAL_KYC_SCHEDULES_TABLE = 'physical_kyc_schedules';
const PHYSICAL_KYC_CHECKLISTS_TABLE = 'physical_kyc_checklists';
const PHYSICAL_KYC_RESULTS_TABLE = 'physical_kyc_results';
const AUDITOR_ACCESS_TOKENS_TABLE = 'auditor_access_tokens';

// KMS Configuration
const KMS_KEY_ID = process.env.KMS_KEY_ID;
// Initialize KMS client
const kms = new AWS.KMS({
  region: process.env.AWS_REGION || 'ap-south-1',
  
});

// Initialize Cognito Identity Service Provider client
const cognito = new AWS.CognitoIdentityServiceProvider({
  region: process.env.AWS_REGION || 'ap-south-1',
  
});

export { dynamoDB, s3, kms, cognito, VENDORS_TABLE, GOOGLE_USERS_TABLE, LEADS_TABLE, PROJECTS_TABLE, PM_PROJECTS_TABLE,USERS_TABLE, WORKSPACES_TABLE, ACTIVITIES_TABLE, WORKSPACE_MESSAGES_TABLE, POST_SERVICES_TABLE, POST_SERVICES_NOTIFICATIONS_TABLE, WORKFLOWS_TABLE, S3_BUCKET_NAME, MESSAGE_UPLOADS_BUCKET, WORKSPACE_UPLOADS_BUCKET, KMS_KEY_ID, PHYSICAL_KYC_SCHEDULES_TABLE, PHYSICAL_KYC_CHECKLISTS_TABLE, PHYSICAL_KYC_RESULTS_TABLE, AUDITOR_ACCESS_TOKENS_TABLE };