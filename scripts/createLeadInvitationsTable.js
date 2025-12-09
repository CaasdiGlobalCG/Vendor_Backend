import AWS from 'aws-sdk';
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
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamodb = new AWS.DynamoDB();
const docClient = new AWS.DynamoDB.DocumentClient();

const LEAD_INVITATIONS_TABLE = 'lead_invitations_table';

// Create Lead Invitations Table
const createLeadInvitationsTable = async () => {
  const params = {
    TableName: LEAD_INVITATIONS_TABLE,
    KeySchema: [
      { AttributeName: 'leadId', KeyType: 'HASH' } // Primary key
    ],
    AttributeDefinitions: [
      { AttributeName: 'leadId', AttributeType: 'S' },
      { AttributeName: 'projectId', AttributeType: 'S' },
      { AttributeName: 'pmId', AttributeType: 'S' },
      { AttributeName: 'vendorId', AttributeType: 'S' },
      { AttributeName: 'status', AttributeType: 'S' },
      { AttributeName: 'sentAt', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'ProjectIdIndex',
        KeySchema: [
          { AttributeName: 'projectId', KeyType: 'HASH' },
          { AttributeName: 'sentAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: {
          ReadCapacityUnits: 1,
          WriteCapacityUnits: 1
        }
      },
      {
        IndexName: 'PMIdIndex',
        KeySchema: [
          { AttributeName: 'pmId', KeyType: 'HASH' },
          { AttributeName: 'sentAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: {
          ReadCapacityUnits: 1,
          WriteCapacityUnits: 1
        }
      },
      {
        IndexName: 'VendorIdIndex',
        KeySchema: [
          { AttributeName: 'vendorId', KeyType: 'HASH' },
          { AttributeName: 'sentAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: {
          ReadCapacityUnits: 1,
          WriteCapacityUnits: 1
        }
      },
      {
        IndexName: 'StatusIndex',
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' },
          { AttributeName: 'sentAt', KeyType: 'RANGE' }
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
    console.log('🚀 Creating Lead Invitations table...');
    await dynamodb.createTable(params).promise();
    console.log('✅ Lead Invitations table created successfully');
    
    // Wait for table to be active
    await dynamodb.waitFor('tableExists', { TableName: LEAD_INVITATIONS_TABLE }).promise();
    console.log('✅ Lead Invitations table is now active');
    
    return true;
  } catch (error) {
    if (error.code === 'ResourceInUseException') {
      console.log('ℹ️ Lead Invitations table already exists');
      return true;
    }
    console.error('❌ Error creating Lead Invitations table:', error);
    return false;
  }
};

// Create Sample Lead Invitations
const createSampleLeadInvitations = async () => {
  const sampleLeads = [
    {
      leadId: 'LEAD-001',
      projectId: 'PROJ-001',
      pmId: 'PM-001',
      vendorId: 'DHA-250509-564',
      
      // Lead details
      leadTitle: 'Construction Lead for Office Building',
      leadDescription: 'We are looking for experienced construction contractors for our modern office building project in Mumbai. The project involves sustainable design and smart building features.',
      
      // Requirements
      specialization: 'Construction',
      estimatedBudget: '$500K - $800K',
      estimatedTimeline: '6-8 months',
      
      // Status workflow: sent → vendor_accepted → pm_approved → workspace_access
      status: 'sent',
      
      // Vendor response (empty initially)
      vendorResponse: null,
      
      // PM decision (empty initially)  
      pmDecision: null,
      
      // Timestamps
      sentAt: '2025-01-15T15:30:00Z',
      updatedAt: '2025-01-15T15:30:00Z',
      
      // Metadata
      priority: 'high',
      tags: ['construction', 'office-building', 'sustainable'],
      
      // Vendor details (for quick reference)
      vendorDetails: {
        name: 'Dhanush Vendor',
        email: 'dhanush@vendor.com',
        companyName: 'Dhanush Construction',
        specialization: 'Construction'
      },
      
      // Project details (for quick reference)
      projectDetails: {
        name: 'Office Building Construction',
        location: 'Mumbai, India',
        category: 'Construction'
      }
    },
    {
      leadId: 'LEAD-002',
      projectId: 'PROJ-002',
      pmId: 'PM-001',
      vendorId: 'vendor-002',
      
      leadTitle: 'Electrical Work for Residential Complex',
      leadDescription: 'Seeking electrical contractors for luxury residential complex with 200 units. Work includes main electrical systems, unit wiring, and smart home integration.',
      
      specialization: 'Electrical',
      estimatedBudget: '$300K - $500K',
      estimatedTimeline: '4-6 months',
      
      status: 'vendor_accepted',
      
      // Vendor has responded
      vendorResponse: {
        acceptedAt: '2025-01-16T09:15:00Z',
        message: 'We are very interested in this project. Our team has extensive experience with residential electrical systems and smart home integration.',
        proposedBudget: '$420K',
        proposedTimeline: '5 months',
        attachments: []
      },
      
      pmDecision: null,
      
      sentAt: '2025-01-10T14:30:00Z',
      updatedAt: '2025-01-16T09:15:00Z',
      
      priority: 'medium',
      tags: ['electrical', 'residential', 'smart-home'],
      
      vendorDetails: {
        name: 'Sarah Wilson',
        email: 'sarah@electrical.com',
        companyName: 'Wilson Electrical',
        specialization: 'Electrical'
      },
      
      projectDetails: {
        name: 'Residential Complex Development',
        location: 'Pune, India',
        category: 'Real Estate'
      }
    },
    {
      leadId: 'LEAD-003',
      projectId: 'PROJ-002',
      pmId: 'PM-001',
      vendorId: 'vendor-003',
      
      leadTitle: 'Plumbing Work for Residential Complex',
      leadDescription: 'Looking for plumbing contractors for luxury residential complex. Work includes main water systems, unit plumbing, and modern fixtures installation.',
      
      specialization: 'Plumbing',
      estimatedBudget: '$200K - $350K',
      estimatedTimeline: '3-5 months',
      
      status: 'pm_approved',
      
      // Complete workflow: vendor accepted → PM approved
      vendorResponse: {
        acceptedAt: '2025-01-12T11:20:00Z',
        message: 'We have completed similar residential projects and would be happy to work on this complex.',
        proposedBudget: '$280K',
        proposedTimeline: '4 months',
        attachments: []
      },
      
      pmDecision: {
        decidedAt: '2025-01-13T16:45:00Z',
        approved: true,
        feedback: 'Approved based on competitive pricing and good timeline. Please proceed with detailed planning.',
        workspaceAccess: true
      },
      
      sentAt: '2025-01-11T10:00:00Z',
      updatedAt: '2025-01-13T16:45:00Z',
      
      priority: 'medium',
      tags: ['plumbing', 'residential', 'luxury'],
      
      vendorDetails: {
        name: 'Mike Johnson',
        email: 'mike@plumbing.com',
        companyName: 'Johnson Plumbing',
        specialization: 'Plumbing'
      },
      
      projectDetails: {
        name: 'Residential Complex Development',
        location: 'Pune, India',
        category: 'Real Estate'
      }
    }
  ];

  console.log('🚀 Creating sample lead invitations...');
  
  for (const lead of sampleLeads) {
    try {
      await docClient.put({
        TableName: LEAD_INVITATIONS_TABLE,
        Item: lead,
        ConditionExpression: 'attribute_not_exists(leadId)' // Don't overwrite existing
      }).promise();

      console.log(`✅ Created lead: ${lead.leadTitle} (${lead.leadId})`);
    } catch (error) {
      if (error.code === 'ConditionalCheckFailedException') {
        console.log(`ℹ️ Lead already exists: ${lead.leadTitle} (${lead.leadId})`);
      } else {
        console.error(`❌ Error creating lead ${lead.leadId}:`, error);
      }
    }
  }
};

// Main execution
const setupLeadInvitationsTable = async () => {
  console.log('🎯 Setting up Lead Invitations Table and Sample Data...\n');
  
  try {
    // Create table
    const tableCreated = await createLeadInvitationsTable();
    
    if (tableCreated) {
      // Create sample leads
      await createSampleLeadInvitations();
      
      console.log('\n🎉 Lead Invitations setup completed successfully!');
      console.log('\n📋 Sample Lead Invitations Created:');
      console.log('1. LEAD-001 - Construction Lead (sent status)');
      console.log('2. LEAD-002 - Electrical Work (vendor_accepted status)');
      console.log('3. LEAD-003 - Plumbing Work (pm_approved status)');
      console.log('\n🔗 Table Name: lead_invitations_table');
      console.log('🔑 Primary Key: leadId');
      console.log('📊 GSI: ProjectIdIndex, PMIdIndex, VendorIdIndex, StatusIndex');
      console.log('\n🔄 Status Flow: sent → vendor_accepted → pm_approved → workspace_access');
    }
  } catch (error) {
    console.error('❌ Setup failed:', error);
  }
};

// Run the setup
setupLeadInvitationsTable();
