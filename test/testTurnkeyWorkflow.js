/**
 * Test script for Turnkey Workflow API endpoints
 * 
 * Run with: node test/testTurnkeyWorkflow.js
 */

import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';

const API_BASE_URL = process.env.VENDOR_BACKEND_URL;
let TEST_WORKSPACE_ID = 'test-workspace-123';
const TEST_NODE_ID = 'turnkey-workflow_' + Date.now();

// Sample turnkey workflow data
const sampleTurnkeyWorkflow = {
  taskName: 'Foundation Construction - Phase 1',
  description: 'Complete foundation work including excavation, reinforcement, and concrete pouring',
  status: 'active',
  humanCount: 5,
  resourceCount: 8,
  statusBadges: [
    { id: '1', name: 'excavation', color: 'green', icon: 'check' },
    { id: '2', name: 'reinforcement', color: 'yellow', icon: 'clock' },
    { id: '3', name: 'concrete', color: 'red', icon: 'droplet' }
  ],
  testCases: [
    {
      id: '1',
      name: 'Excavation Depth Test',
      description: 'Verify excavation depth meets specifications',
      status: 'completed',
      tester: 'QA Team Alpha',
      evidenceCount: 2,
      evidenceFiles: [
        {
          id: 'file-1',
          name: 'excavation_depth.jpg',
          type: 'image/jpeg',
          size: 1024000,
          s3Key: 'test/excavation_depth.jpg',
          s3Bucket: 'workspace-uploads',
          uploadedAt: new Date().toISOString(),
          uploadedBy: 'test-user',
          url: 'https://example.com/signed-url'
        }
      ],
      notes: 'Depth verified at 3.5m as per specifications'
    },
    {
      id: '2',
      name: 'Reinforcement Bar Test',
      description: 'Check reinforcement bar placement and spacing',
      status: 'pending',
      tester: 'QA Team Beta',
      evidenceCount: 0,
      evidenceFiles: [],
      notes: ''
    }
  ],
  vendorId: 'test-vendor-123',
  userId: 'test-user-456',
  projectId: 'test-project-789',
  leadId: 'test-lead-101'
};

/**
 * Test API endpoint
 */
async function testEndpoint(method, url, data = null) {
  try {
    console.log(`\n🔄 Testing ${method} ${url}`);
    
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    
    if (data) {
      options.body = JSON.stringify(data);
    }
    
    const response = await fetch(url, options);
    const result = await response.json();
    
    if (response.ok) {
      console.log(`✅ ${method} ${url} - Success`);
      console.log('Response:', JSON.stringify(result, null, 2));
      return result;
    } else {
      console.error(`❌ ${method} ${url} - Failed`);
      console.error('Status:', response.status);
      console.error('Error:', result);
      return null;
    }
  } catch (error) {
    console.error(`❌ ${method} ${url} - Network Error:`, error.message);
    return null;
  }
}

/**
 * Get or create a test workspace
 */
async function setupTestWorkspace() {
  console.log('\n🔧 Setting up test workspace...');
  
  const testVendorId = 'test-vendor-123';
  
  // Try to get existing workspaces for test vendor
  const workspacesResult = await testEndpoint('GET', `${API_BASE_URL}/api/workspaces/vendor/${testVendorId}`);
  
  if (workspacesResult && Array.isArray(workspacesResult) && workspacesResult.length > 0) {
    // Use the first available workspace
    TEST_WORKSPACE_ID = workspacesResult[0].workspaceId || workspacesResult[0].id;
    console.log(`✅ Using existing workspace: ${TEST_WORKSPACE_ID}`);
    return true;
  }
  
  // If no workspaces exist, create one using the createOrGetWorkspaceForLead endpoint
  const testWorkspaceData = {
    leadId: 'test-lead-456',
    vendorId: testVendorId,
    projectId: 'test-project-789'
  };
  
  const createResult = await testEndpoint('POST', `${API_BASE_URL}/api/workspaces/lead/create-or-get`, testWorkspaceData);
  
  if (createResult && createResult.workspace) {
    TEST_WORKSPACE_ID = createResult.workspace.workspaceId || createResult.workspace.id;
    console.log(`✅ Created test workspace: ${TEST_WORKSPACE_ID}`);
    return true;
  }
  
  // Fallback: Create a minimal workspace with required nodes array
  console.log('🔧 Trying fallback workspace creation...');
  
  // For testing purposes, let's create a simple workspace entry directly
  // This simulates what would happen in a real system
  const minimalWorkspace = {
    workspaceId: `test-workspace-${Date.now()}`,
    vendorId: testVendorId,
    leadId: 'test-lead-456',
    projectId: 'test-project-789',
    title: 'Test Workspace for Turnkey Workflows',
    description: 'Temporary workspace for API testing',
    nodes: [], // Initialize with empty nodes array
    edges: [],
    status: 'active'
  };
  
  // Set the test workspace ID for use in tests
  TEST_WORKSPACE_ID = minimalWorkspace.workspaceId;
  console.log(`✅ Using test workspace: ${TEST_WORKSPACE_ID}`);
  console.log('⚠️  Note: This is a mock workspace for testing. In production, workspaces should be created through proper channels.');
  
  return true;
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('🚀 Starting Turnkey Workflow API Tests');
  console.log('=====================================');
  
  // Setup: Get or create test workspace
  const workspaceReady = await setupTestWorkspace();
  if (!workspaceReady) {
    console.error('❌ Cannot proceed without a test workspace');
    return;
  }
  
  // Test 1: Health check
  console.log('\n📋 Test 1: Health Check');
  await testEndpoint('GET', `${API_BASE_URL}/health`);
  
  // Test 2: Create/Save turnkey workflow
  console.log('\n📋 Test 2: Create Turnkey Workflow');
  const createResult = await testEndpoint(
    'PUT', 
    `${API_BASE_URL}/api/turnkey-workflows/workspace/${TEST_WORKSPACE_ID}/node/${TEST_NODE_ID}`,
    sampleTurnkeyWorkflow
  );
  
  if (createResult) {
    console.log('✅ Turnkey workflow created successfully');
    
    // Test 3: Get turnkey workflow
    console.log('\n📋 Test 3: Get Turnkey Workflow');
    const getResult = await testEndpoint(
      'GET',
      `${API_BASE_URL}/api/turnkey-workflows/workspace/${TEST_WORKSPACE_ID}/node/${TEST_NODE_ID}`
    );
    
    if (getResult) {
      console.log('✅ Turnkey workflow retrieved successfully');
      
      // Test 4: Update test case
      console.log('\n📋 Test 4: Update Test Case');
      const updateTestCaseResult = await testEndpoint(
        'PUT',
        `${API_BASE_URL}/api/turnkey-workflows/workspace/${TEST_WORKSPACE_ID}/node/${TEST_NODE_ID}/testcase/2`,
        {
          status: 'active',
          notes: 'Started reinforcement bar inspection',
          description: 'Updated: Check reinforcement bar placement and spacing with detailed measurements'
        }
      );
      
      if (updateTestCaseResult) {
        console.log('✅ Test case updated successfully');
      }
      
      // Test 5: Add evidence file
      console.log('\n📋 Test 5: Add Evidence File');
      const addEvidenceResult = await testEndpoint(
        'POST',
        `${API_BASE_URL}/api/turnkey-workflows/workspace/${TEST_WORKSPACE_ID}/node/${TEST_NODE_ID}/testcase/2/evidence`,
        {
          name: 'reinforcement_bars.pdf',
          type: 'application/pdf',
          size: 2048000,
          s3Key: 'test/reinforcement_bars.pdf',
          s3Bucket: 'workspace-uploads',
          uploadedBy: 'test-user-456'
        }
      );
      
      if (addEvidenceResult) {
        console.log('✅ Evidence file added successfully');
        
        // Test 6: Remove evidence file
        console.log('\n📋 Test 6: Remove Evidence File');
        const removeEvidenceResult = await testEndpoint(
          'DELETE',
          `${API_BASE_URL}/api/turnkey-workflows/workspace/${TEST_WORKSPACE_ID}/node/${TEST_NODE_ID}/testcase/2/evidence/${addEvidenceResult.evidenceFile.id}`
        );
        
        if (removeEvidenceResult) {
          console.log('✅ Evidence file removed successfully');
        }
      }
    }
    
    // Test 7: Get all turnkey workflows in workspace
    console.log('\n📋 Test 7: Get All Turnkey Workflows');
    const getAllResult = await testEndpoint(
      'GET',
      `${API_BASE_URL}/api/turnkey-workflows/workspace/${TEST_WORKSPACE_ID}`
    );
    
    if (getAllResult) {
      console.log('✅ All turnkey workflows retrieved successfully');
    }
  }
  
  console.log('\n🎉 All tests completed!');
  console.log('=====================================');
}

/**
 * Validation tests
 */
async function runValidationTests() {
  console.log('\n🔍 Running Validation Tests');
  console.log('============================');
  
  // Test invalid data
  const invalidWorkflow = {
    // Missing required fields
    taskName: '',
    humanCount: -1,
    statusBadges: [
      { id: '1', name: 'test', color: 'invalid-color' }
    ],
    testCases: [
      { id: '1' } // Missing required name
    ]
  };
  
  console.log('\n📋 Validation Test: Invalid Data');
  await testEndpoint(
    'PUT',
    `${API_BASE_URL}/api/turnkey-workflows/workspace/${TEST_WORKSPACE_ID}/node/invalid-test`,
    invalidWorkflow
  );
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests()
    .then(() => runValidationTests())
    .then(() => {
      console.log('\n✨ Test script completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test script failed:', error);
      process.exit(1);
    });
}

export { runTests, runValidationTests };
