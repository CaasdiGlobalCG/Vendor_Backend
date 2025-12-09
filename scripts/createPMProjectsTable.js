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

const PM_PROJECTS_TABLE = 'pm_projects_table';

// Create PM Projects Table
const createPMProjectsTable = async () => {
  const params = {
    TableName: PM_PROJECTS_TABLE,
    KeySchema: [
      { AttributeName: 'projectId', KeyType: 'HASH' } // Primary key
    ],
    AttributeDefinitions: [
      { AttributeName: 'projectId', AttributeType: 'S' },
      { AttributeName: 'pmId', AttributeType: 'S' },
      { AttributeName: 'status', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'PMIdIndex',
        KeySchema: [
          { AttributeName: 'pmId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
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
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
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
    console.log('🚀 Creating PM Projects table...');
    await dynamodb.createTable(params).promise();
    console.log('✅ PM Projects table created successfully');
    
    // Wait for table to be active
    await dynamodb.waitFor('tableExists', { TableName: PM_PROJECTS_TABLE }).promise();
    console.log('✅ PM Projects table is now active');
    
    return true;
  } catch (error) {
    if (error.code === 'ResourceInUseException') {
      console.log('ℹ️ PM Projects table already exists');
      return true;
    }
    console.error('❌ Error creating PM Projects table:', error);
    return false;
  }
};

// Create Sample PM Projects
const createSamplePMProjects = async () => {
  const sampleProjects = [
    {
      projectId: 'PROJ-001',
      pmId: 'PM-001',
      name: 'Office Building Construction',
      description: 'Modern 10-story office building with sustainable design and smart building features',
      status: 'draft',
      budget: '$2.5M',
      timeline: '18 months',
      priority: 'high',
      location: 'Mumbai, India',
      category: 'Construction',
      
      // Project phases
      phases: [
        { id: 1, name: 'Planning & Design', status: 'pending', startDate: null, endDate: null },
        { id: 2, name: 'Foundation & Structure', status: 'pending', startDate: null, endDate: null },
        { id: 3, name: 'Interior & Finishing', status: 'pending', startDate: null, endDate: null },
        { id: 4, name: 'Testing & Handover', status: 'pending', startDate: null, endDate: null }
      ],
      
      // Vendor requirements
      vendorRequirements: [
        { specialization: 'Construction', required: true, maxVendors: 2 },
        { specialization: 'Electrical', required: true, maxVendors: 1 },
        { specialization: 'Plumbing', required: true, maxVendors: 1 },
        { specialization: 'Interior Design', required: false, maxVendors: 1 }
      ],
      
      // Invited vendors (empty initially)
      invitedVendors: [],
      approvedVendors: [],
      
      // Workspace info
      workspaceId: null,
      workspaceCreated: false,
      
      // Metadata
      createdAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-01-15T10:00:00Z',
      createdBy: 'PM-001',
      tags: ['construction', 'office', 'sustainable', 'smart-building']
    },
    {
      projectId: 'PROJ-002',
      pmId: 'PM-001',
      name: 'Residential Complex Development',
      description: 'Luxury residential complex with 200 units, amenities, and green spaces',
      status: 'active',
      budget: '$5.2M',
      timeline: '24 months',
      priority: 'medium',
      location: 'Pune, India',
      category: 'Real Estate',
      
      phases: [
        { id: 1, name: 'Site Preparation', status: 'completed', startDate: '2024-12-01', endDate: '2024-12-15' },
        { id: 2, name: 'Foundation Work', status: 'in_progress', startDate: '2024-12-16', endDate: null },
        { id: 3, name: 'Construction', status: 'pending', startDate: null, endDate: null },
        { id: 4, name: 'Amenities & Landscaping', status: 'pending', startDate: null, endDate: null }
      ],
      
      vendorRequirements: [
        { specialization: 'Construction', required: true, maxVendors: 3 },
        { specialization: 'Electrical', required: true, maxVendors: 2 },
        { specialization: 'Plumbing', required: true, maxVendors: 2 },
        { specialization: 'Landscaping', required: true, maxVendors: 1 }
      ],
      
      invitedVendors: [
        {
          vendorId: 'DHA-250509-564',
          name: 'Dhanush Vendor',
          email: 'dhanush@vendor.com',
          companyName: 'Dhanush Construction',
          specialization: 'Construction',
          status: 'pending',
          invitedAt: '2025-01-10T14:30:00Z',
          leadId: null
        }
      ],
      approvedVendors: [],
      
      workspaceId: 'WS-002',
      workspaceCreated: true,
      
      createdAt: '2024-12-01T09:00:00Z',
      updatedAt: '2025-01-10T14:30:00Z',
      createdBy: 'PM-001',
      tags: ['residential', 'luxury', 'amenities', 'green-spaces']
    },
    {
      projectId: 'PROJ-003',
      pmId: 'PM-002',
      name: 'Infrastructure Bridge Project',
      description: 'Modern cable-stayed bridge connecting two major districts',
      status: 'planning',
      budget: '$8.7M',
      timeline: '36 months',
      priority: 'high',
      location: 'Delhi, India',
      category: 'Infrastructure',
      
      phases: [
        { id: 1, name: 'Environmental Assessment', status: 'in_progress', startDate: '2025-01-01', endDate: null },
        { id: 2, name: 'Design & Engineering', status: 'pending', startDate: null, endDate: null },
        { id: 3, name: 'Construction Phase 1', status: 'pending', startDate: null, endDate: null },
        { id: 4, name: 'Construction Phase 2', status: 'pending', startDate: null, endDate: null },
        { id: 5, name: 'Testing & Commissioning', status: 'pending', startDate: null, endDate: null }
      ],
      
      vendorRequirements: [
        { specialization: 'Civil Engineering', required: true, maxVendors: 2 },
        { specialization: 'Steel Construction', required: true, maxVendors: 1 },
        { specialization: 'Electrical', required: true, maxVendors: 1 },
        { specialization: 'Safety Systems', required: true, maxVendors: 1 }
      ],
      
      invitedVendors: [],
      approvedVendors: [],
      
      workspaceId: null,
      workspaceCreated: false,
      
      createdAt: '2025-01-01T08:00:00Z',
      updatedAt: '2025-01-01T08:00:00Z',
      createdBy: 'PM-002',
      tags: ['infrastructure', 'bridge', 'engineering', 'transportation']
    }
  ];

  console.log('🚀 Creating sample PM projects...');
  
  for (const project of sampleProjects) {
    try {
      await docClient.put({
        TableName: PM_PROJECTS_TABLE,
        Item: project,
        ConditionExpression: 'attribute_not_exists(projectId)' // Don't overwrite existing
      }).promise();

      console.log(`✅ Created project: ${project.name} (${project.projectId})`);
    } catch (error) {
      if (error.code === 'ConditionalCheckFailedException') {
        console.log(`ℹ️ Project already exists: ${project.name} (${project.projectId})`);
      } else {
        console.error(`❌ Error creating project ${project.name}:`, error);
      }
    }
  }
};

// Main execution
const setupPMProjectsTable = async () => {
  console.log('🎯 Setting up PM Projects Table and Sample Data...\n');
  
  try {
    // Create table
    const tableCreated = await createPMProjectsTable();
    
    if (tableCreated) {
      // Create sample projects
      await createSamplePMProjects();
      
      console.log('\n🎉 PM Projects setup completed successfully!');
      console.log('\n📋 Sample Projects Created:');
      console.log('1. PROJ-001 - Office Building Construction (PM-001)');
      console.log('2. PROJ-002 - Residential Complex Development (PM-001)');
      console.log('3. PROJ-003 - Infrastructure Bridge Project (PM-002)');
      console.log('\n🔗 Table Name: pm_projects_table');
      console.log('🔑 Primary Key: projectId');
      console.log('📊 GSI: PMIdIndex (pmId + createdAt)');
      console.log('📊 GSI: StatusIndex (status + createdAt)');
    }
  } catch (error) {
    console.error('❌ Setup failed:', error);
  }
};

// Run the setup
setupPMProjectsTable();
