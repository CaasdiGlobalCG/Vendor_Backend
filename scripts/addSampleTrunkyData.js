import AWS from 'aws-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Configure AWS
const dynamoDB = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const addSampleData = async () => {
  try {
    console.log('🚀 Adding sample Trunky data...');

    // Sample task data
    const sampleTask = {
      physical_asset_id: 'task-001',
      task_name: 'Foundation Construction',
      asset_name: 'Building Foundation',
      phase: 'Foundation work - Phase 1',
      status: 'in_progress',
      completed_steps: 'site_preparation,excavation',
      total_steps: 6,
      human_resources: 8,
      physical_resources: 12,
      location: 'Site A - Block 1',
      description: 'Foundation construction for new building project',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Add task to physical assets table
    await dynamoDB.put({
      TableName: 'trunky_physical_assets',
      Item: sampleTask
    }).promise();

    console.log('✅ Added sample task');

    // Sample test cases
    const testCases = [
      {
        test_case_id: 'TC-001',
        test_case_name: 'Concrete Quality Test',
        task_id: 'task-001',
        physical_asset_id: 'task-001',
        status: 'active',
        evidence_count: 3,
        s3_url: 'https://trunky-evidence-files.s3.amazonaws.com/test-case-1/',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        test_case_id: 'TC-002',
        test_case_name: 'Foundation Depth Verification',
        task_id: 'task-001',
        physical_asset_id: 'task-001',
        status: 'pending',
        evidence_count: 1,
        s3_url: 'https://trunky-evidence-files.s3.amazonaws.com/test-case-2/',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        test_case_id: 'TC-003',
        test_case_name: 'Reinforcement Inspection',
        task_id: 'task-001',
        physical_asset_id: 'task-001',
        status: 'completed',
        evidence_count: 5,
        s3_url: 'https://trunky-evidence-files.s3.amazonaws.com/test-case-3/',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ];

    // Add test cases
    for (const testCase of testCases) {
      await dynamoDB.put({
        TableName: 'trunky_evidence_files_table',
        Item: testCase
      }).promise();
    }

    console.log('✅ Added sample test cases');

    // Add another sample task
    const sampleTask2 = {
      physical_asset_id: 'task-002',
      task_name: 'Electrical Installation',
      asset_name: 'Building Electrical System',
      phase: 'Electrical work - Phase 2',
      status: 'pending',
      completed_steps: 'planning,material_procurement',
      total_steps: 5,
      human_resources: 4,
      physical_resources: 8,
      location: 'Site A - Block 2',
      description: 'Electrical system installation and testing',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await dynamoDB.put({
      TableName: 'trunky_physical_assets',
      Item: sampleTask2
    }).promise();

    console.log('✅ Added second sample task');

    console.log('🎉 Sample data added successfully!');
    
  } catch (error) {
    console.error('❌ Error adding sample data:', error);
  }
};

addSampleData();
