import AWS from 'aws-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Configure AWS SDK
AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamoDB = new AWS.DynamoDB();

const createWorkspacesTable = async () => {
  const params = {
    TableName: 'workspaces_table',
    KeySchema: [
      {
        AttributeName: 'workspaceId',
        KeyType: 'HASH' // Partition key
      }
    ],
    AttributeDefinitions: [
      {
        AttributeName: 'workspaceId',
        AttributeType: 'S'
      },
      {
        AttributeName: 'projectId',
        AttributeType: 'S'
      },
      {
        AttributeName: 'createdAt',
        AttributeType: 'S'
      }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'ProjectIdIndex',
        KeySchema: [
          {
            AttributeName: 'projectId',
            KeyType: 'HASH'
          },
          {
            AttributeName: 'createdAt',
            KeyType: 'RANGE'
          }
        ],
        Projection: {
          ProjectionType: 'ALL'
        }
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  };

  try {
    console.log('🔧 Creating workspaces_table...');
    
    // Check if table already exists
    try {
      await dynamoDB.describeTable({ TableName: 'workspaces_table' }).promise();
      console.log('✅ workspaces_table already exists');
      return;
    } catch (error) {
      if (error.code !== 'ResourceNotFoundException') {
        throw error;
      }
    }

    // Create the table
    const result = await dynamoDB.createTable(params).promise();
    console.log('✅ workspaces_table created successfully:', result.TableDescription.TableName);

    // Wait for table to be active
    console.log('⏳ Waiting for table to be active...');
    await dynamoDB.waitFor('tableExists', { TableName: 'workspaces_table' }).promise();
    console.log('✅ workspaces_table is now active');

    // Add sample workspace data
    await addSampleWorkspaces();

  } catch (error) {
    console.error('❌ Error creating workspaces table:', error);
    throw error;
  }
};

const addSampleWorkspaces = async () => {
  const documentClient = new AWS.DynamoDB.DocumentClient();
  
  const sampleWorkspaces = [
    {
      workspaceId: 'WS-SAMPLE-001',
      projectId: 'PROJ-001',
      title: 'Office Building Construction - Collaborative Workspace',
      description: 'PM-Vendor collaborative workspace for Office Building Construction',
      accessControl: {
        owner: 'PM-001',
        collaborators: ['DHA-250509-564'],
        permissions: {
          canEdit: ['PM-001'],
          canComment: ['PM-001', 'DHA-250509-564'],
          canViewFiles: ['PM-001', 'DHA-250509-564'],
          canCreateTasks: ['PM-001'],
          canAssignTasks: ['PM-001'],
          canUpdateTaskStatus: ['DHA-250509-564']
        }
      },
      isShared: true,
      sharedWith: ['DHA-250509-564'],
      projectMetadata: {
        pmId: 'PM-001',
        vendorId: 'DHA-250509-564',
        leadId: 'LEAD-001',
        projectName: 'Office Building Construction',
        projectDescription: 'Modern office building with sustainable design',
        leadTitle: 'Construction Lead for Office Building',
        approvedAt: '2025-01-15T16:00:00Z'
      },
      nodes: [
        {
          id: 'project-info',
          type: 'text',
          position: { x: 100, y: 100 },
          data: {
            content: '# Office Building Construction\n\n**Description:** Modern office building with sustainable design\n\n**Budget:** $2.5M\n**Timeline:** 18 months\n\n---\n\n## Lead Information\n**Title:** Construction Lead for Office Building\n**Specialization:** Construction\n**Priority:** High'
          }
        },
        {
          id: 'collaboration-guide',
          type: 'text',
          position: { x: 400, y: 100 },
          data: {
            content: '# Collaboration Guidelines\n\n## PM Responsibilities:\n- Project oversight and task assignment\n- Timeline and milestone management\n- Quality assurance and approvals\n\n## Vendor Responsibilities:\n- Task execution and status updates\n- Progress reporting\n- Quality deliverables\n\n## Communication:\n- Use comments for discussions\n- Update task status regularly\n- Escalate issues promptly'
          }
        }
      ],
      layers: [
        {
          id: 'background',
          name: 'Background',
          visible: true,
          locked: false
        },
        {
          id: 'content',
          name: 'Content',
          visible: true,
          locked: false
        }
      ],
      createdAt: '2025-01-15T16:00:00Z',
      updatedAt: '2025-01-15T16:00:00Z',
      createdBy: 'pm_PM-001',
      status: 'active'
    }
  ];

  try {
    console.log('📝 Adding sample workspace data...');
    
    for (const workspace of sampleWorkspaces) {
      await documentClient.put({
        TableName: 'workspaces_table',
        Item: workspace
      }).promise();
      
      console.log(`✅ Added sample workspace: ${workspace.workspaceId}`);
    }
    
    console.log('✅ Sample workspace data added successfully');
  } catch (error) {
    console.error('❌ Error adding sample workspace data:', error);
  }
};

// Run the script
createWorkspacesTable()
  .then(() => {
    console.log('🎉 Workspaces table setup completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Failed to setup workspaces table:', error);
    process.exit(1);
  });
