/**
 * Simple Test script for Turnkey Workflow Models and Validation
 * 
 * Run with: node test/testTurnkeyWorkflowSimple.js
 */

import { 
  createTurnkeyWorkflow, 
  updateTurnkeyWorkflow, 
  validateTurnkeyWorkflow,
  addEvidenceFile,
  removeEvidenceFile 
} from '../models/TurnkeyWorkflow.js';

/**
 * Test the model functions directly
 */
async function testTurnkeyWorkflowModels() {
  console.log('🚀 Testing Turnkey Workflow Models');
  console.log('==================================');

  // Test 1: Create Turnkey Workflow
  console.log('\n📋 Test 1: Create Turnkey Workflow');
  try {
    const workflowData = {
      nodeId: 'test-node-123',
      workspaceId: 'test-workspace-456',
      taskName: 'Foundation Construction - Phase 1',
      description: 'Complete foundation work including excavation, reinforcement, and concrete pouring',
      status: 'active',
      humanCount: 5,
      resourceCount: 8,
      vendorId: 'test-vendor-789'
    };

    const workflow = await createTurnkeyWorkflow(workflowData);
    console.log('✅ Workflow created successfully:');
    console.log(`   - Workflow ID: ${workflow.workflowId}`);
    console.log(`   - Task Name: ${workflow.taskName}`);
    console.log(`   - Status Badges: ${workflow.statusBadges.length}`);
    console.log(`   - Test Cases: ${workflow.testCases.length}`);
    console.log(`   - Completion: ${workflow.completionPercentage}%`);

    // Test 2: Update Turnkey Workflow
    console.log('\n📋 Test 2: Update Turnkey Workflow');
    const updateData = {
      taskName: 'Updated Foundation Construction - Phase 1',
      status: 'in-progress',
      testCases: [
        ...workflow.testCases,
        {
          id: '3',
          name: 'New Test Case',
          description: 'Additional test case',
          status: 'completed',
          tester: 'QA team Gamma',
          evidenceCount: 1,
          evidenceFiles: [],
          assignedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          notes: 'Test completed successfully'
        }
      ]
    };

    const updatedWorkflow = await updateTurnkeyWorkflow(workflow.workflowId, updateData);
    console.log('✅ Workflow updated successfully:');
    console.log(`   - Updated Task Name: ${updatedWorkflow.taskName}`);
    console.log(`   - Test Cases: ${updatedWorkflow.testCases.length}`);
    console.log(`   - Completion: ${updatedWorkflow.completionPercentage}%`);

    // Test 3: Add Evidence File
    console.log('\n📋 Test 3: Add Evidence File');
    const fileData = {
      name: 'foundation_inspection.jpg',
      type: 'image/jpeg',
      size: 1024000,
      s3Key: 'test/foundation_inspection.jpg',
      s3Bucket: 'workspace-uploads',
      uploadedBy: 'test-user-123'
    };

    const evidenceFile = await addEvidenceFile(workflow.workflowId, '1', fileData);
    console.log('✅ Evidence file added successfully:');
    console.log(`   - File ID: ${evidenceFile.id}`);
    console.log(`   - File Name: ${evidenceFile.name}`);
    console.log(`   - S3 Key: ${evidenceFile.s3Key}`);
    console.log(`   - Uploaded At: ${evidenceFile.uploadedAt}`);

    // Test 4: Remove Evidence File
    console.log('\n📋 Test 4: Remove Evidence File');
    const removeResult = await removeEvidenceFile(workflow.workflowId, '1', evidenceFile.id);
    console.log('✅ Evidence file removed successfully:');
    console.log(`   - Success: ${removeResult.success}`);
    console.log(`   - File ID: ${removeResult.fileId}`);

    return workflow;
  } catch (error) {
    console.error('❌ Error in workflow model tests:', error);
    return null;
  }
}

/**
 * Test validation functions
 */
async function testValidation() {
  console.log('\n🔍 Testing Validation Functions');
  console.log('===============================');

  // Test 1: Valid Data
  console.log('\n📋 Test 1: Valid Data Validation');
  const validData = {
    nodeId: 'valid-node-123',
    workspaceId: 'valid-workspace-456',
    taskName: 'Valid Task Name',
    humanCount: 5,
    resourceCount: 3,
    statusBadges: [
      { id: '1', name: 'watering', color: 'green', icon: 'check' }
    ],
    testCases: [
      {
        id: '1',
        name: 'Valid Test Case',
        status: 'pending',
        evidenceFiles: [
          { id: '1', name: 'test.jpg', s3Key: 'test/test.jpg' }
        ]
      }
    ]
  };

  const validResult = validateTurnkeyWorkflow(validData);
  console.log('✅ Valid data validation result:');
  console.log(`   - Is Valid: ${validResult.isValid}`);
  console.log(`   - Errors: ${validResult.errors.length}`);

  // Test 2: Invalid Data
  console.log('\n📋 Test 2: Invalid Data Validation');
  const invalidData = {
    // Missing nodeId and workspaceId
    taskName: '', // Empty task name
    humanCount: -1, // Negative number
    resourceCount: 'invalid', // Non-number
    statusBadges: [
      { id: '1', name: 'test', color: 'invalid-color' }, // Invalid color
      { name: 'no-id' } // Missing id
    ],
    testCases: [
      { id: '1' }, // Missing name
      { id: '2', name: 'Test', status: 'invalid-status' }, // Invalid status
      {
        id: '3',
        name: 'Test with files',
        evidenceFiles: [
          { id: '1', name: 'test.jpg' } // Missing s3Key
        ]
      }
    ]
  };

  const invalidResult = validateTurnkeyWorkflow(invalidData);
  console.log('✅ Invalid data validation result:');
  console.log(`   - Is Valid: ${invalidResult.isValid}`);
  console.log(`   - Errors Found: ${invalidResult.errors.length}`);
  invalidResult.errors.forEach((error, index) => {
    console.log(`     ${index + 1}. ${error}`);
  });
}

/**
 * Test edge cases
 */
async function testEdgeCases() {
  console.log('\n🎯 Testing Edge Cases');
  console.log('====================');

  // Test 1: Minimal Valid Data
  console.log('\n📋 Test 1: Minimal Valid Data');
  const minimalData = {
    nodeId: 'minimal-node',
    workspaceId: 'minimal-workspace',
    taskName: 'Minimal Task'
  };

  const minimalResult = validateTurnkeyWorkflow(minimalData);
  console.log('✅ Minimal data validation:');
  console.log(`   - Is Valid: ${minimalResult.isValid}`);
  console.log(`   - Errors: ${minimalResult.errors.length}`);

  if (minimalResult.isValid) {
    const minimalWorkflow = await createTurnkeyWorkflow(minimalData);
    console.log('✅ Minimal workflow created:');
    console.log(`   - Default Status Badges: ${minimalWorkflow.statusBadges.length}`);
    console.log(`   - Default Test Cases: ${minimalWorkflow.testCases.length}`);
    console.log(`   - Default Human Count: ${minimalWorkflow.humanCount}`);
    console.log(`   - Default Resource Count: ${minimalWorkflow.resourceCount}`);
  }

  // Test 2: Empty Arrays
  console.log('\n📋 Test 2: Empty Arrays');
  const emptyArraysData = {
    nodeId: 'empty-arrays-node',
    workspaceId: 'empty-arrays-workspace',
    taskName: 'Empty Arrays Task',
    statusBadges: [],
    testCases: []
  };

  const emptyArraysWorkflow = await createTurnkeyWorkflow(emptyArraysData);
  console.log('✅ Empty arrays workflow created:');
  console.log(`   - Status Badges: ${emptyArraysWorkflow.statusBadges.length}`);
  console.log(`   - Test Cases: ${emptyArraysWorkflow.testCases.length}`);
  console.log(`   - Completion Percentage: ${emptyArraysWorkflow.completionPercentage}%`);

  // Test 3: Large Data
  console.log('\n📋 Test 3: Large Data Set');
  const largeTestCases = Array.from({ length: 10 }, (_, i) => ({
    id: `test-case-${i + 1}`,
    name: `Test Case ${i + 1}`,
    description: `Description for test case ${i + 1}`,
    status: i % 3 === 0 ? 'completed' : i % 3 === 1 ? 'active' : 'pending',
    tester: `QA Team ${String.fromCharCode(65 + (i % 3))}`, // A, B, C
    evidenceCount: i % 4,
    evidenceFiles: Array.from({ length: i % 4 }, (_, j) => ({
      id: `file-${i}-${j}`,
      name: `evidence_${i}_${j}.jpg`,
      s3Key: `test/evidence_${i}_${j}.jpg`
    })),
    assignedAt: new Date().toISOString(),
    completedAt: i % 3 === 0 ? new Date().toISOString() : null,
    notes: `Notes for test case ${i + 1}`
  }));

  const largeDataWorkflow = await createTurnkeyWorkflow({
    nodeId: 'large-data-node',
    workspaceId: 'large-data-workspace',
    taskName: 'Large Data Task',
    testCases: largeTestCases
  });

  console.log('✅ Large data workflow created:');
  console.log(`   - Test Cases: ${largeDataWorkflow.testCases.length}`);
  console.log(`   - Completion Percentage: ${largeDataWorkflow.completionPercentage}%`);
  console.log(`   - Total Evidence Files: ${largeDataWorkflow.testCases.reduce((sum, tc) => sum + (tc.evidenceFiles?.length || 0), 0)}`);
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('🎉 Starting Turnkey Workflow Model Tests');
  console.log('=========================================');

  try {
    // Test models
    const workflow = await testTurnkeyWorkflowModels();
    
    if (workflow) {
      // Test validation
      await testValidation();
      
      // Test edge cases
      await testEdgeCases();
      
      console.log('\n🎉 All tests completed successfully!');
      console.log('=====================================');
    } else {
      console.error('\n❌ Model tests failed, skipping other tests');
    }
  } catch (error) {
    console.error('\n💥 Test suite failed:', error);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests()
    .then(() => {
      console.log('\n✨ Test script completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test script failed:', error);
      process.exit(1);
    });
}

export { runAllTests };

