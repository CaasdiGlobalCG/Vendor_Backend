import { dynamoDB, WORKSPACES_TABLE } from '../config/aws.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Turnkey Workflow Model
 * Handles CRUD operations for turnkey workflow elements within workspace nodes
 */

// Turnkey Workflow Schema Definition
export const TurnkeyWorkflowSchema = {
  // Basic workflow information
  workflowId: 'string', // Unique identifier for the workflow
  nodeId: 'string', // ReactFlow node ID
  workspaceId: 'string', // Parent workspace ID
  
  // Task details
  taskName: 'string', // e.g., "Foundation work - phase 1"
  description: 'string', // Detailed description
  status: 'string', // 'active', 'pending', 'completed', 'on-hold'
  
  // Resource allocation
  humanCount: 'number', // Number of human resources
  resourceCount: 'number', // Number of material/equipment resources
  
  // Status badges (dynamic indicators)
  statusBadges: [
    {
      id: 'string',
      name: 'string', // e.g., 'watering', 'drying', 'curing'
      color: 'string', // 'green', 'yellow', 'red', 'blue'
      icon: 'string' // 'check', 'clock', 'droplet', etc.
    }
  ],
  
  // Test cases with comprehensive data
  testCases: [
    {
      id: 'string',
      name: 'string', // e.g., "Test case 1"
      description: 'string', // Detailed test description
      status: 'string', // 'pending', 'active', 'completed', 'failed'
      tester: 'string', // e.g., "QA team Alpha"
      
      // Evidence management
      evidenceCount: 'number', // Total number of evidence files
      evidenceFiles: [
        {
          id: 'string', // Unique file identifier
          name: 'string', // Original filename
          type: 'string', // MIME type
          size: 'number', // File size in bytes
          s3Key: 'string', // S3 object key
          s3Bucket: 'string', // S3 bucket name
          uploadedAt: 'string', // ISO timestamp
          uploadedBy: 'string', // User ID who uploaded
          url: 'string', // Signed URL (temporary, generated on demand)
        }
      ],
      
      // Test execution details
      assignedAt: 'string', // ISO timestamp when assigned
      completedAt: 'string', // ISO timestamp when completed
      notes: 'string', // Additional notes/comments
    }
  ],
  
  // Workflow metadata
  createdAt: 'string', // ISO timestamp
  updatedAt: 'string', // ISO timestamp
  createdBy: 'string', // User ID who created
  lastModifiedBy: 'string', // User ID who last modified
  
  // Integration fields
  projectId: 'string', // Link to PM system
  leadId: 'string', // Link to lead/client
  vendorId: 'string', // Link to vendor
  
  // Workflow state
  isActive: 'boolean', // Whether workflow is currently active
  completionPercentage: 'number', // Overall completion percentage
  estimatedDuration: 'number', // Estimated duration in hours
  actualDuration: 'number', // Actual duration in hours
};

/**
 * Create a new turnkey workflow element
 */
export const createTurnkeyWorkflow = async (workflowData) => {
  const workflowId = uuidv4();
  const now = new Date().toISOString();
  
  const workflow = {
    workflowId,
    nodeId: workflowData.nodeId,
    workspaceId: workflowData.workspaceId,
    
    // Task details
    taskName: workflowData.taskName || 'Turnkey task 1',
    description: workflowData.description || 'Foundation work - phase 1',
    status: workflowData.status || 'active',
    
    // Resources
    humanCount: workflowData.humanCount || 3,
    resourceCount: workflowData.resourceCount || 4,
    
    // Status badges with defaults
    statusBadges: workflowData.statusBadges || [
      { id: '1', name: 'watering', color: 'green', icon: 'check' },
      { id: '2', name: 'drying', color: 'yellow', icon: 'droplet' }
    ],
    
    // Test cases with defaults
    testCases: workflowData.testCases || [
      {
        id: '1',
        name: 'Test case 1',
        description: '',
        status: 'pending',
        tester: 'QA team Alpha',
        evidenceCount: 0,
        evidenceFiles: [],
        assignedAt: now,
        completedAt: null,
        notes: ''
      },
      {
        id: '2',
        name: 'Test case 2',
        description: '',
        status: 'pending',
        tester: 'QA team Beta',
        evidenceCount: 0,
        evidenceFiles: [],
        assignedAt: now,
        completedAt: null,
        notes: ''
      }
    ],
    
    // Metadata
    createdAt: now,
    updatedAt: now,
    createdBy: workflowData.createdBy || workflowData.vendorId,
    lastModifiedBy: workflowData.createdBy || workflowData.vendorId,
    
    // Integration
    projectId: workflowData.projectId,
    leadId: workflowData.leadId,
    vendorId: workflowData.vendorId,
    
    // State
    isActive: true,
    completionPercentage: 0,
    estimatedDuration: workflowData.estimatedDuration || 0,
    actualDuration: 0
  };
  
  console.log('🏗️ Creating turnkey workflow:', {
    workflowId,
    workspaceId: workflow.workspaceId,
    taskName: workflow.taskName,
    testCasesCount: workflow.testCases.length
  });
  
  return workflow;
};

/**
 * Update an existing turnkey workflow
 */
export const updateTurnkeyWorkflow = async (workflowId, updateData) => {
  const now = new Date().toISOString();
  
  // Calculate completion percentage based on test case statuses
  let completionPercentage = 0;
  if (updateData.testCases && updateData.testCases.length > 0) {
    const completedTestCases = updateData.testCases.filter(tc => tc.status === 'completed').length;
    completionPercentage = Math.round((completedTestCases / updateData.testCases.length) * 100);
  }
  
  const updatedWorkflow = {
    ...updateData,
    workflowId,
    updatedAt: now,
    lastModifiedBy: updateData.lastModifiedBy || updateData.vendorId,
    completionPercentage
  };
  
  console.log('🔄 Updating turnkey workflow:', {
    workflowId,
    completionPercentage,
    testCasesCount: updateData.testCases?.length || 0
  });
  
  return updatedWorkflow;
};

/**
 * Add evidence file to a test case
 */
export const addEvidenceFile = async (workflowId, testCaseId, fileData) => {
  const evidenceFile = {
    id: uuidv4(),
    name: fileData.name,
    type: fileData.type,
    size: fileData.size,
    s3Key: fileData.s3Key,
    s3Bucket: fileData.s3Bucket || 'workspace-uploads',
    uploadedAt: new Date().toISOString(),
    uploadedBy: fileData.uploadedBy,
    url: null // Will be generated on demand
  };
  
  console.log('📎 Adding evidence file to test case:', {
    workflowId,
    testCaseId,
    fileName: evidenceFile.name,
    fileSize: evidenceFile.size
  });
  
  return evidenceFile;
};

/**
 * Remove evidence file from a test case
 */
export const removeEvidenceFile = async (workflowId, testCaseId, fileId) => {
  console.log('🗑️ Removing evidence file from test case:', {
    workflowId,
    testCaseId,
    fileId
  });
  
  // In a real implementation, you might also want to delete the file from S3
  // This would require additional logic to handle S3 cleanup
  
  return { success: true, fileId };
};

/**
 * Validate turnkey workflow data
 */
export const validateTurnkeyWorkflow = (workflowData) => {
  const errors = [];
  
  // Required fields validation
  if (!workflowData.nodeId) {
    errors.push('nodeId is required');
  }
  
  if (!workflowData.workspaceId) {
    errors.push('workspaceId is required');
  }
  
  if (!workflowData.taskName || workflowData.taskName.trim().length === 0) {
    errors.push('taskName is required and cannot be empty');
  }
  
  // Validate status badges
  if (workflowData.statusBadges) {
    workflowData.statusBadges.forEach((badge, index) => {
      if (!badge.id || !badge.name) {
        errors.push(`statusBadges[${index}] must have id and name`);
      }
      if (badge.color && !['green', 'yellow', 'red', 'blue', 'purple', 'gray'].includes(badge.color)) {
        errors.push(`statusBadges[${index}] has invalid color: ${badge.color}`);
      }
    });
  }
  
  // Validate test cases
  if (workflowData.testCases) {
    workflowData.testCases.forEach((testCase, index) => {
      if (!testCase.id || !testCase.name) {
        errors.push(`testCases[${index}] must have id and name`);
      }
      if (testCase.status && !['pending', 'active', 'completed', 'failed'].includes(testCase.status)) {
        errors.push(`testCases[${index}] has invalid status: ${testCase.status}`);
      }
      
      // Validate evidence files
      if (testCase.evidenceFiles) {
        testCase.evidenceFiles.forEach((file, fileIndex) => {
          if (!file.id || !file.name || !file.s3Key) {
            errors.push(`testCases[${index}].evidenceFiles[${fileIndex}] must have id, name, and s3Key`);
          }
        });
      }
    });
  }
  
  // Validate numeric fields
  if (workflowData.humanCount !== undefined && (typeof workflowData.humanCount !== 'number' || workflowData.humanCount < 0)) {
    errors.push('humanCount must be a non-negative number');
  }
  
  if (workflowData.resourceCount !== undefined && (typeof workflowData.resourceCount !== 'number' || workflowData.resourceCount < 0)) {
    errors.push('resourceCount must be a non-negative number');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

export default {
  TurnkeyWorkflowSchema,
  createTurnkeyWorkflow,
  updateTurnkeyWorkflow,
  addEvidenceFile,
  removeEvidenceFile,
  validateTurnkeyWorkflow
};

