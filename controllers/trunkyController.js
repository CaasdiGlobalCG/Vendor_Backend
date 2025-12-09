import AWS from 'aws-sdk';

// Configure AWS
const dynamoDB = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

// Internal helper function to get Trunky data
const getTrunkyTasksInternal = async () => {
  console.log('🔍 Fetching Trunky data...');

    // Fetch physical assets (equipment/resources)
    const assetsParams = {
      TableName: 'trunky_physical_assets'
    };
    const assetsResult = await dynamoDB.scan(assetsParams).promise();
    console.log(`🏗️ Found ${assetsResult.Items.length} physical assets`);

    // Fetch human resources
    const humanResourcesParams = {
      TableName: 'trunky_human_resources'
    };
    const humanResourcesResult = await dynamoDB.scan(humanResourcesParams).promise();
    console.log(`👥 Found ${humanResourcesResult.Items.length} human resources`);

    // Fetch evidence files (test cases)
    const evidenceParams = {
      TableName: 'trunky_evidence_files_table'
    };
    const evidenceResult = await dynamoDB.scan(evidenceParams).promise();
    console.log(`🧪 Found ${evidenceResult.Items.length} evidence files`);

    // Group evidence by test case ID
    const testCasesMap = {};
    evidenceResult.Items.forEach(evidence => {
      const testCaseId = evidence.testCaseId;
      if (!testCasesMap[testCaseId]) {
        testCasesMap[testCaseId] = {
          id: testCaseId,
          name: `Test Case ${testCaseId}`,
          status: evidence.isApproved ? 'completed' : 'pending',
          evidenceCount: 0,
          evidenceFiles: [],
          category: evidence.category,
          uploadedBy: evidence.uploadedBy,
          createdAt: evidence.uploadedAt
        };
      }
      testCasesMap[testCaseId].evidenceCount++;
      testCasesMap[testCaseId].evidenceFiles.push({
        id: evidence.evidenceId,
        fileName: evidence.fileName,
        fileType: evidence.fileType,
        s3Key: evidence.s3Key,
        s3BucketName: evidence.s3BucketName,
        description: evidence.description,
        uploadedAt: evidence.uploadedAt,
        isApproved: evidence.isApproved
      });
    });

    const testCases = Object.values(testCasesMap);

    // Create a consolidated task view
    const consolidatedTask = {
      id: 'trunky-main-project',
      name: 'Trunky Project Management',
      phase: 'Active Development Phase',
      status: 'in_progress',
      completedSteps: ['planning', 'resource_allocation'],
      totalSteps: 5,
      humanResources: humanResourcesResult.Items.length,
      physicalResources: assetsResult.Items.length,
      testCases: testCases,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      location: 'Multiple Sites',
      description: 'Comprehensive project management with QA testing and resource coordination',
      assets: assetsResult.Items.map(asset => ({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        status: asset.status,
        condition: asset.condition,
        location: asset.location,
        assignedTo: asset.assignedTo
      })),
      humanResources: humanResourcesResult.Items.map(resource => ({
        id: resource.id,
        name: resource.name,
        role: resource.role,
        status: resource.status,
        skills: resource.skills,
        utilization: resource.utilization,
        assignment: resource.assignment
      }))
    };

    console.log('✅ Successfully formatted Trunky data');
    return {
      success: true,
      tasks: [consolidatedTask],
      totalTasks: 1,
      totalTestCases: testCases.length,
      totalAssets: assetsResult.Items.length,
      totalHumanResources: humanResourcesResult.Items.length
    };
};

// Get all Trunky tasks with their test cases
const getTrunkyTasks = async (req, res) => {
  try {
    const result = await getTrunkyTasksInternal();
    res.json(result);
  } catch (error) {
    console.error('❌ Error fetching Trunky tasks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Trunky tasks',
      details: error.message
    });
  }
};

// Get specific Trunky task by ID
const getTrunkyTaskById = async (req, res) => {
  try {
    const { taskId } = req.params;
    console.log(`🔍 Fetching Trunky task: ${taskId}`);

    // Since we're using a consolidated approach, just return the main project data
    // In the future, this could be expanded to support multiple projects/tasks
    if (taskId === 'trunky-main-project') {
      // Reuse the logic from getTrunkyTasks but return single task
      const result = await getTrunkyTasksInternal();
      if (result.tasks && result.tasks.length > 0) {
        return res.json({
          success: true,
          task: result.tasks[0]
        });
      }
    }

    return res.status(404).json({
      success: false,
      error: 'Task not found'
    });

  } catch (error) {
    console.error('❌ Error fetching Trunky task:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Trunky task',
      details: error.message
    });
  }
};

// Get Trunky data for workspace element
const getTrunkyDataForWorkspace = async (req, res) => {
  try {
    const { workspaceId, elementId } = req.params;
    console.log(`🔍 Fetching Trunky data for workspace: ${workspaceId}, element: ${elementId}`);

    // Just return the main consolidated task data
    const result = await getTrunkyTasksInternal();
    
    console.log('✅ Successfully fetched Trunky data for workspace');
    res.json({
      success: true,
      task: result.tasks[0],
      config: null
    });

  } catch (error) {
    console.error('❌ Error fetching Trunky data for workspace:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Trunky data for workspace',
      details: error.message
    });
  }
};

export {
  getTrunkyTasks,
  getTrunkyTaskById,
  getTrunkyDataForWorkspace
};
