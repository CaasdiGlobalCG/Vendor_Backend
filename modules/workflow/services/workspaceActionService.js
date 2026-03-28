import * as DynamoWorkspace from '../../workspace/models/DynamoWorkspace.js';

const nowIso = () => new Date().toISOString();

const buildNode = (templateType, taskData = {}) => {
  const nodeId = taskData.nodeId || `wf_node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const status = taskData.status || 'Pending';

  return {
    id: nodeId,
    type: taskData.nodeType || 'custom',
    position: taskData.position || { x: 120, y: 120 },
    data: {
      label: taskData.name || taskData.title || `${templateType || 'Task'} ${new Date().toLocaleDateString('en-GB')}`,
      name: taskData.name || taskData.title || `${templateType || 'Task'}`,
      description: taskData.description || '',
      status,
      category: templateType || taskData.category || 'workflow',
      assignedUserId: taskData.assignedUserId || null,
      assignedTo: taskData.assignedUserId || null,
      workflowCreated: true,
      workflowMetadata: {
        templateType: templateType || 'custom',
        createdAt: nowIso()
      }
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
};

const normalizeCompletedStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'complete' || normalized === 'done') {
    return 'Completed';
  }
  return status;
};

const patchRootNodeById = (workspace, nodeId, patcher) => {
  const nodes = Array.isArray(workspace.nodes) ? workspace.nodes : [];
  let found = false;

  const updatedNodes = nodes.map((node) => {
    if (!node || node.id !== nodeId) return node;
    found = true;
    return patcher(node);
  });

  return { found, updatedNodes };
};

const patchSubtaskNodeById = (workspace, nodeId, patcher) => {
  const tasks = Array.isArray(workspace.tasks) ? workspace.tasks : [];
  let found = false;

  const updatedTasks = tasks.map((task) => {
    const subtasks = Array.isArray(task?.subtasks) ? task.subtasks : [];
    let touchedSubtask = false;

    const updatedSubtasks = subtasks.map((subtask) => {
      const canvasData = subtask?.canvasData || { nodes: [], edges: [], zoomLevel: 100 };
      const canvasNodes = Array.isArray(canvasData.nodes) ? canvasData.nodes : [];
      let nodeTouched = false;

      const updatedCanvasNodes = canvasNodes.map((node) => {
        if (!node || node.id !== nodeId) return node;
        nodeTouched = true;
        found = true;
        return patcher(node);
      });

      if (!nodeTouched) return subtask;
      touchedSubtask = true;

      return {
        ...subtask,
        canvasData: {
          ...canvasData,
          nodes: updatedCanvasNodes
        },
        updatedAt: nowIso()
      };
    });

    if (!touchedSubtask) return task;

    return {
      ...task,
      subtasks: updatedSubtasks,
      updatedAt: nowIso()
    };
  });

  return { found, updatedTasks };
};

const patchTaskAssignmentById = (workspace, nodeId, userId) => {
  const tasks = Array.isArray(workspace.tasks) ? workspace.tasks : [];
  let found = false;

  const updatedTasks = tasks.map((task) => {
    let taskUpdated = false;
    let updatedTask = task;

    if (task?.id === nodeId) {
      taskUpdated = true;
      found = true;
      updatedTask = {
        ...updatedTask,
        assignedUserIds: userId ? [userId] : [],
        assignedUsers: userId ? 1 : 0,
        updatedAt: nowIso()
      };
    }

    const subtasks = Array.isArray(updatedTask?.subtasks) ? updatedTask.subtasks : [];
    const updatedSubtasks = subtasks.map((subtask) => {
      if (subtask?.id !== nodeId) return subtask;
      taskUpdated = true;
      found = true;
      return {
        ...subtask,
        assignedUserIds: userId ? [userId] : [],
        assignedUsers: userId ? 1 : 0,
        updatedAt: nowIso()
      };
    });

    if (!taskUpdated) return task;

    return {
      ...updatedTask,
      subtasks: updatedSubtasks,
      updatedAt: nowIso()
    };
  });

  return { found, updatedTasks };
};

export const createTaskInWorkspace = async (templateType, taskData = {}) => {
  const workspaceId = taskData.workspaceId;
  if (!workspaceId) {
    throw new Error('create-task requires workspaceId');
  }

  const workspace = await DynamoWorkspace.getWorkspaceById(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  const node = buildNode(templateType, taskData);
  const taskId = taskData.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const newTask = {
    id: taskId,
    name: node.data.name,
    description: node.data.description,
    priority: taskData.priority || 'medium',
    status: normalizeCompletedStatus(node.data.status) || 'Pending',
    dueDate: taskData.dueDate || null,
    assignedUserIds: taskData.assignedUserId ? [taskData.assignedUserId] : [],
    assignedUsers: taskData.assignedUserId ? 1 : 0,
    color: taskData.color || 'bg-blue-500',
    subtasks: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    sourceNodeId: node.id,
    source: 'workflow'
  };

  const updatedWorkspace = await DynamoWorkspace.updateWorkspace(workspaceId, {
    nodes: [...(workspace.nodes || []), node],
    tasks: [...(workspace.tasks || []), newTask]
  });

  return {
    id: node.id,
    nodeId: node.id,
    taskId: newTask.id,
    name: node.data.name,
    workspaceId,
    workspaceUpdatedAt: updatedWorkspace?.updatedAt || nowIso()
  };
};

export const updateNodeStatusInWorkspace = async (nodeId, newStatus, message, options = {}) => {
  const workspaceId = options.workspaceId;
  if (!workspaceId) {
    throw new Error('update-status requires workspaceId');
  }
  if (!newStatus) {
    throw new Error('update-status requires newStatus');
  }

  const workspace = await DynamoWorkspace.getWorkspaceById(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  const normalizedStatus = normalizeCompletedStatus(newStatus);
  let previousStatus = null;

  const rootPatch = patchRootNodeById(workspace, nodeId, (node) => {
    const currentData = node.data || {};
    previousStatus = currentData.status || null;

    return {
      ...node,
      data: {
        ...currentData,
        status: normalizedStatus,
        statusMessage: message || currentData.statusMessage || null,
        updatedByWorkflow: true,
        updatedAt: nowIso()
      },
      updatedAt: nowIso()
    };
  });

  let nextTasks = Array.isArray(workspace.tasks) ? workspace.tasks : [];
  let nodeFound = rootPatch.found;

  if (!nodeFound) {
    const subtaskPatch = patchSubtaskNodeById(workspace, nodeId, (node) => {
      const currentData = node.data || {};
      previousStatus = currentData.status || null;

      return {
        ...node,
        data: {
          ...currentData,
          status: normalizedStatus,
          statusMessage: message || currentData.statusMessage || null,
          updatedByWorkflow: true,
          updatedAt: nowIso()
        },
        updatedAt: nowIso()
      };
    });

    nodeFound = subtaskPatch.found;
    nextTasks = subtaskPatch.updatedTasks;
  }

  // Keep task/subtask status in sync when IDs match.
  nextTasks = nextTasks.map((task) => {
    let changed = false;
    let updatedTask = task;

    if (task?.id === nodeId) {
      previousStatus = previousStatus || task.status || null;
      changed = true;
      updatedTask = {
        ...updatedTask,
        status: normalizedStatus,
        updatedAt: nowIso()
      };
    }

    const subtasks = Array.isArray(updatedTask?.subtasks) ? updatedTask.subtasks : [];
    const updatedSubtasks = subtasks.map((subtask) => {
      if (subtask?.id !== nodeId) return subtask;
      previousStatus = previousStatus || subtask.status || null;
      changed = true;
      return {
        ...subtask,
        status: normalizedStatus,
        updatedAt: nowIso()
      };
    });

    if (!changed) return task;

    return {
      ...updatedTask,
      subtasks: updatedSubtasks,
      updatedAt: nowIso()
    };
  });

  if (!nodeFound && previousStatus === null) {
    throw new Error(`Node not found in workspace ${workspaceId}: ${nodeId}`);
  }

  await DynamoWorkspace.updateWorkspace(workspaceId, {
    nodes: rootPatch.updatedNodes,
    tasks: nextTasks
  });

  return {
    workspaceId,
    nodeId,
    oldStatus: previousStatus,
    newStatus: normalizedStatus
  };
};

export const assignUserInWorkspace = async (nodeId, userId, options = {}) => {
  const workspaceId = options.workspaceId;
  if (!workspaceId) {
    throw new Error('assign-user requires workspaceId');
  }

  const workspace = await DynamoWorkspace.getWorkspaceById(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  const rootPatch = patchRootNodeById(workspace, nodeId, (node) => {
    const currentData = node.data || {};
    return {
      ...node,
      data: {
        ...currentData,
        assignedUserId: userId,
        assignedTo: userId,
        updatedByWorkflow: true,
        updatedAt: nowIso()
      },
      updatedAt: nowIso()
    };
  });

  const subtaskPatch = patchSubtaskNodeById(
    workspace,
    nodeId,
    (node) => {
      const currentData = node.data || {};
      return {
        ...node,
        data: {
          ...currentData,
          assignedUserId: userId,
          assignedTo: userId,
          updatedByWorkflow: true,
          updatedAt: nowIso()
        },
        updatedAt: nowIso()
      };
    }
  );

  const taskPatch = patchTaskAssignmentById(
    {
      ...workspace,
      tasks: subtaskPatch.updatedTasks
    },
    nodeId,
    userId
  );

  const foundAny = rootPatch.found || subtaskPatch.found || taskPatch.found;
  if (!foundAny) {
    throw new Error(`Node/Task not found in workspace ${workspaceId}: ${nodeId}`);
  }

  await DynamoWorkspace.updateWorkspace(workspaceId, {
    nodes: rootPatch.updatedNodes,
    tasks: taskPatch.updatedTasks
  });

  return {
    workspaceId,
    nodeId,
    assignedTo: userId
  };
};
