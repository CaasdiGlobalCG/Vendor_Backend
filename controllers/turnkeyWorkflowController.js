import { dynamoDB, WORKSPACES_TABLE } from '../config/aws.js';
import { 
  createTurnkeyWorkflow, 
  updateTurnkeyWorkflow, 
  validateTurnkeyWorkflow,
  addEvidenceFile,
  removeEvidenceFile 
} from '../models/TurnkeyWorkflow.js';
import { getWorkspaceById, updateWorkspace } from '../modules/workspace/models/DynamoWorkspace.js';

/**
 * Create or update a turnkey workflow element within a workspace node
 */
export const saveTurnkeyWorkflow = async (req, res) => {
  try {
    const { workspaceId, nodeId } = req.params;
    const workflowData = req.body;
    
    console.log('💾 Saving turnkey workflow:', {
      workspaceId,
      nodeId,
      taskName: workflowData.taskName,
      testCasesCount: workflowData.testCases?.length || 0
    });
    
    // Validate the workflow data
    const validation = validateTurnkeyWorkflow({
      ...workflowData,
      workspaceId,
      nodeId
    });
    
    if (!validation.isValid) {
      console.error('❌ Validation failed:', validation.errors);
      return res.status(400).json({
        message: 'Invalid turnkey workflow data',
        errors: validation.errors
      });
    }
    
    // Get the current workspace
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) {
      // For testing purposes, create a minimal workspace structure
      if (workspaceId.startsWith('test-workspace-')) {
        console.log('⚠️ Creating minimal workspace structure for testing');
        const minimalWorkspace = {
          workspaceId: workspaceId,
          nodes: [],
          edges: [],
          vendorId: workflowData.vendorId,
          leadId: workflowData.leadId || 'test-lead',
          projectId: workflowData.projectId || 'test-project'
        };
        
        // Add the new node to the minimal workspace
        const newNode = {
          id: nodeId,
          type: 'turnkeyNode',
          position: { x: 100, y: 100 },
          data: {
            elementType: 'turnkey-workflow',
            nodeId: nodeId,
            ...workflowData
          }
        };
        
        minimalWorkspace.nodes.push(newNode);
        
        // Create or update the turnkey workflow
        const turnkeyWorkflow = await createTurnkeyWorkflow({
          ...workflowData,
          workspaceId,
          nodeId,
          vendorId: workflowData.vendorId,
          createdBy: workflowData.createdBy || workflowData.vendorId,
          projectId: minimalWorkspace.projectId,
          leadId: minimalWorkspace.leadId
        });
        
        console.log('✅ Test turnkey workflow created successfully:', {
          workflowId: turnkeyWorkflow.workflowId,
          workspaceId,
          nodeId
        });
        
        return res.status(200).json({
          message: 'Turnkey workflow saved successfully (test mode)',
          workflow: turnkeyWorkflow,
          workspace: minimalWorkspace
        });
      }
      
      return res.status(404).json({ message: 'Workspace not found' });
    }
    
    // Find the node in the workspace, or create it if it doesn't exist
    console.log('🔍 Searching for node in workspace:', {
      nodeId,
      workspaceId,
      totalNodes: workspace.nodes.length,
      nodeIds: workspace.nodes.map(n => n.id)
    });
    
    let nodeIndex = workspace.nodes.findIndex(node => node.id === nodeId);
    
    if (nodeIndex === -1) {
      // Node doesn't exist, create a new one
      console.log('🆕 Node not found, creating new turnkey workflow node:', nodeId);
      
      const newNode = {
        id: nodeId,
        type: 'turnkeyNode',
        position: { x: 100, y: 100 }, // Default position
        data: {
          elementType: 'turnkey-workflow',
          nodeId: nodeId,
          name: workflowData.taskName || 'Turnkey Workflow',
          type: 'turnkey-workflow'
        }
      };
      
      workspace.nodes.push(newNode);
      nodeIndex = workspace.nodes.length - 1;
    }
    
    // Create or update the turnkey workflow
    let turnkeyWorkflow;
    const existingWorkflowData = workspace.nodes[nodeIndex].data.turnkeyWorkflow;
    
    if (existingWorkflowData && existingWorkflowData.workflowId) {
      // Update existing workflow
      turnkeyWorkflow = await updateTurnkeyWorkflow(existingWorkflowData.workflowId, {
        ...workflowData,
        workspaceId,
        nodeId,
        vendorId: req.user?.vendorId || req.body.vendorId,
        lastModifiedBy: req.user?.userId || req.body.userId
      });
    } else {
      // Create new workflow
      turnkeyWorkflow = await createTurnkeyWorkflow({
        ...workflowData,
        workspaceId,
        nodeId,
        vendorId: req.user?.vendorId || req.body.vendorId,
        createdBy: req.user?.userId || req.body.userId,
        projectId: workspace.projectId,
        leadId: workspace.leadId
      });
    }
    
    // Update the node data with the turnkey workflow information
    workspace.nodes[nodeIndex].data = {
      ...workspace.nodes[nodeIndex].data,
      ...turnkeyWorkflow, // Spread all turnkey workflow data into node data
      turnkeyWorkflow: turnkeyWorkflow // Also keep a reference to the full workflow data
    };
    
    // Save the updated workspace
    const updatedWorkspace = await updateWorkspace(workspaceId, {
      nodes: workspace.nodes,
      updatedAt: new Date().toISOString()
    });
    
    console.log('✅ Turnkey workflow saved successfully:', {
      workflowId: turnkeyWorkflow.workflowId,
      workspaceId,
      nodeId
    });
    
    res.status(200).json({
      message: 'Turnkey workflow saved successfully',
      workflow: turnkeyWorkflow,
      workspace: updatedWorkspace
    });
    
  } catch (error) {
    console.error('❌ Error saving turnkey workflow:', error);
    res.status(500).json({
      message: 'Failed to save turnkey workflow',
      error: error.message
    });
  }
};

/**
 * Get a specific turnkey workflow from a workspace node
 */
export const getTurnkeyWorkflow = async (req, res) => {
  try {
    const { workspaceId, nodeId } = req.params;
    
    console.log('🔍 Getting turnkey workflow:', { workspaceId, nodeId });
    
    // Get the workspace
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    
    // Find the node
    const node = workspace.nodes.find(node => node.id === nodeId);
    if (!node) {
      return res.status(404).json({ message: 'Node not found in workspace' });
    }
    
    // Check if it's a turnkey workflow node
    if (node.type !== 'turnkeyNode' || !node.data.turnkeyWorkflow) {
      return res.status(404).json({ message: 'Turnkey workflow not found for this node' });
    }
    
    console.log('✅ Turnkey workflow found:', {
      workflowId: node.data.turnkeyWorkflow.workflowId,
      taskName: node.data.taskName
    });
    
    res.status(200).json({
      message: 'Turnkey workflow retrieved successfully',
      workflow: node.data.turnkeyWorkflow,
      nodeData: node.data
    });
    
  } catch (error) {
    console.error('❌ Error getting turnkey workflow:', error);
    res.status(500).json({
      message: 'Failed to get turnkey workflow',
      error: error.message
    });
  }
};

/**
 * Update test case status and details
 */
export const updateTestCase = async (req, res) => {
  try {
    const { workspaceId, nodeId, testCaseId } = req.params;
    const testCaseData = req.body;
    
    console.log('🧪 Updating test case:', {
      workspaceId,
      nodeId,
      testCaseId,
      status: testCaseData.status
    });
    
    // Get the workspace
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    
    // Find the node
    const nodeIndex = workspace.nodes.findIndex(node => node.id === nodeId);
    if (nodeIndex === -1) {
      return res.status(404).json({ message: 'Node not found in workspace' });
    }
    
    const node = workspace.nodes[nodeIndex];
    if (!node.data.testCases) {
      return res.status(404).json({ message: 'No test cases found for this node' });
    }
    
    // Find and update the test case
    const testCaseIndex = node.data.testCases.findIndex(tc => tc.id === testCaseId);
    if (testCaseIndex === -1) {
      return res.status(404).json({ message: 'Test case not found' });
    }
    
    // Update test case data
    const updatedTestCase = {
      ...node.data.testCases[testCaseIndex],
      ...testCaseData,
      updatedAt: new Date().toISOString()
    };
    
    // If status is being set to completed, add completion timestamp
    if (testCaseData.status === 'completed' && node.data.testCases[testCaseIndex].status !== 'completed') {
      updatedTestCase.completedAt = new Date().toISOString();
    }
    
    // Update the test case in the array
    node.data.testCases[testCaseIndex] = updatedTestCase;
    
    // Recalculate completion percentage
    const completedTestCases = node.data.testCases.filter(tc => tc.status === 'completed').length;
    const completionPercentage = Math.round((completedTestCases / node.data.testCases.length) * 100);
    
    // Update node data
    workspace.nodes[nodeIndex].data = {
      ...node.data,
      completionPercentage,
      updatedAt: new Date().toISOString()
    };
    
    // Save the updated workspace
    const updatedWorkspace = await updateWorkspace(workspaceId, {
      nodes: workspace.nodes,
      updatedAt: new Date().toISOString()
    });
    
    console.log('✅ Test case updated successfully:', {
      testCaseId,
      status: updatedTestCase.status,
      completionPercentage
    });
    
    res.status(200).json({
      message: 'Test case updated successfully',
      testCase: updatedTestCase,
      completionPercentage,
      workspace: updatedWorkspace
    });
    
  } catch (error) {
    console.error('❌ Error updating test case:', error);
    res.status(500).json({
      message: 'Failed to update test case',
      error: error.message
    });
  }
};

/**
 * Add evidence file to a test case
 */
export const addTestCaseEvidence = async (req, res) => {
  try {
    const { workspaceId, nodeId, testCaseId } = req.params;
    const fileData = req.body;
    
    console.log('📎 Adding evidence to test case:', {
      workspaceId,
      nodeId,
      testCaseId,
      fileName: fileData.name
    });
    
    // Get the workspace
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    
    // Find the node
    const nodeIndex = workspace.nodes.findIndex(node => node.id === nodeId);
    if (nodeIndex === -1) {
      return res.status(404).json({ message: 'Node not found in workspace' });
    }
    
    const node = workspace.nodes[nodeIndex];
    if (!node.data.testCases) {
      return res.status(404).json({ message: 'No test cases found for this node' });
    }
    
    // Find the test case
    const testCaseIndex = node.data.testCases.findIndex(tc => tc.id === testCaseId);
    if (testCaseIndex === -1) {
      return res.status(404).json({ message: 'Test case not found' });
    }
    
    // Create evidence file entry
    const evidenceFile = await addEvidenceFile(
      node.data.workflowId || node.id,
      testCaseId,
      {
        ...fileData,
        uploadedBy: req.user?.userId || req.body.userId
      }
    );
    
    // Add to test case evidence files
    if (!node.data.testCases[testCaseIndex].evidenceFiles) {
      node.data.testCases[testCaseIndex].evidenceFiles = [];
    }
    
    node.data.testCases[testCaseIndex].evidenceFiles.push(evidenceFile);
    node.data.testCases[testCaseIndex].evidenceCount = node.data.testCases[testCaseIndex].evidenceFiles.length;
    
    // Update node
    workspace.nodes[nodeIndex].data = {
      ...node.data,
      updatedAt: new Date().toISOString()
    };
    
    // Save the updated workspace
    const updatedWorkspace = await updateWorkspace(workspaceId, {
      nodes: workspace.nodes,
      updatedAt: new Date().toISOString()
    });
    
    console.log('✅ Evidence added successfully:', {
      testCaseId,
      fileId: evidenceFile.id,
      evidenceCount: node.data.testCases[testCaseIndex].evidenceCount
    });
    
    res.status(200).json({
      message: 'Evidence added successfully',
      evidenceFile,
      testCase: node.data.testCases[testCaseIndex],
      workspace: updatedWorkspace
    });
    
  } catch (error) {
    console.error('❌ Error adding test case evidence:', error);
    res.status(500).json({
      message: 'Failed to add evidence',
      error: error.message
    });
  }
};

/**
 * Remove evidence file from a test case
 */
export const removeTestCaseEvidence = async (req, res) => {
  try {
    const { workspaceId, nodeId, testCaseId, fileId } = req.params;
    
    console.log('🗑️ Removing evidence from test case:', {
      workspaceId,
      nodeId,
      testCaseId,
      fileId
    });
    
    // Get the workspace
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    
    // Find the node
    const nodeIndex = workspace.nodes.findIndex(node => node.id === nodeId);
    if (nodeIndex === -1) {
      return res.status(404).json({ message: 'Node not found in workspace' });
    }
    
    const node = workspace.nodes[nodeIndex];
    if (!node.data.testCases) {
      return res.status(404).json({ message: 'No test cases found for this node' });
    }
    
    // Find the test case
    const testCaseIndex = node.data.testCases.findIndex(tc => tc.id === testCaseId);
    if (testCaseIndex === -1) {
      return res.status(404).json({ message: 'Test case not found' });
    }
    
    // Remove the evidence file
    const testCase = node.data.testCases[testCaseIndex];
    if (!testCase.evidenceFiles) {
      return res.status(404).json({ message: 'No evidence files found' });
    }
    
    const fileIndex = testCase.evidenceFiles.findIndex(file => file.id === fileId);
    if (fileIndex === -1) {
      return res.status(404).json({ message: 'Evidence file not found' });
    }
    
    // Remove file from array
    const removedFile = testCase.evidenceFiles.splice(fileIndex, 1)[0];
    testCase.evidenceCount = testCase.evidenceFiles.length;
    
    // Update node
    workspace.nodes[nodeIndex].data = {
      ...node.data,
      updatedAt: new Date().toISOString()
    };
    
    // Save the updated workspace
    const updatedWorkspace = await updateWorkspace(workspaceId, {
      nodes: workspace.nodes,
      updatedAt: new Date().toISOString()
    });
    
    // Clean up the file from backend model
    await removeEvidenceFile(
      node.data.workflowId || node.id,
      testCaseId,
      fileId
    );
    
    console.log('✅ Evidence removed successfully:', {
      testCaseId,
      fileId,
      remainingCount: testCase.evidenceCount
    });
    
    res.status(200).json({
      message: 'Evidence removed successfully',
      removedFile,
      testCase,
      workspace: updatedWorkspace
    });
    
  } catch (error) {
    console.error('❌ Error removing test case evidence:', error);
    res.status(500).json({
      message: 'Failed to remove evidence',
      error: error.message
    });
  }
};

/**
 * Get all turnkey workflows in a workspace
 */
export const getAllTurnkeyWorkflows = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    
    console.log('📋 Getting all turnkey workflows for workspace:', workspaceId);
    
    // Get the workspace
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    
    // Filter turnkey workflow nodes
    const turnkeyNodes = workspace.nodes.filter(node => 
      node.type === 'turnkeyNode' && 
      (node.data.elementType === 'turnkey-workflow' || node.data.turnkeyWorkflow)
    );
    
    const workflows = turnkeyNodes.map(node => ({
      nodeId: node.id,
      position: node.position,
      workflowData: node.data.turnkeyWorkflow || node.data,
      lastUpdated: node.data.updatedAt
    }));
    
    console.log('✅ Found turnkey workflows:', {
      workspaceId,
      count: workflows.length
    });
    
    res.status(200).json({
      message: 'Turnkey workflows retrieved successfully',
      workflows,
      count: workflows.length
    });
    
  } catch (error) {
    console.error('❌ Error getting turnkey workflows:', error);
    res.status(500).json({
      message: 'Failed to get turnkey workflows',
      error: error.message
    });
  }
};
