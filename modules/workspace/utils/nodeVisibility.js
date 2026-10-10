/**
 * Node audience filtering for workspace canvases.
 *
 * A canvas node may carry `data.visibleTo` — the list of roles allowed to see
 * it. Nodes without the field are visible to everyone, so every node created
 * before this feature keeps working unchanged.
 *
 * Two responsibilities:
 *  1. redact*  — strip nodes from a response for a viewer who may not see them
 *                (the real privacy boundary; hiding in React is not enough).
 *  2. preserve* — re-add nodes the writer cannot see when they save, so a
 *                restricted viewer never deletes hidden content by saving.
 */

export const WORKSPACE_ROLES = ['pm', 'vendor', 'client'];

const ROLE_ALIASES = {
  admin: 'pm',
  owner: 'pm',
  manager: 'pm',
  superadmin: 'pm',
  'super-admin': 'pm',
};

/** Map any role string onto the audience vocabulary; null when unknown. */
export const normalizeRole = (role) => {
  if (!role) return null;
  const value = String(role).trim().toLowerCase();
  if (ROLE_ALIASES[value]) return ROLE_ALIASES[value];
  return WORKSPACE_ROLES.includes(value) ? value : null;
};

/** Audience for a node's data; missing/empty/unusable means "everyone". */
export const getNodeAudience = (data) => {
  const raw = data?.visibleTo;
  if (!Array.isArray(raw) || raw.length === 0) return [...WORKSPACE_ROLES];

  const normalized = raw.map(normalizeRole).filter(Boolean);
  const filtered = WORKSPACE_ROLES.filter((role) => normalized.includes(role));
  return filtered.length > 0 ? filtered : [...WORKSPACE_ROLES];
};

/**
 * Can this role see the node? Unknown roles and unrestricted nodes fail open,
 * so a role we don't recognise can never accidentally lose content.
 */
export const canRoleSeeNode = (data, role) => {
  const normalized = normalizeRole(role);
  if (!normalized) return true;
  return getNodeAudience(data).includes(normalized);
};

export const redactNodesForRole = (nodes, role) => {
  if (!Array.isArray(nodes)) return nodes;
  const normalized = normalizeRole(role);
  if (!normalized) return nodes;
  return nodes.filter((node) => canRoleSeeNode(node?.data, normalized));
};

/**
 * Redact every canvas a workspace carries: the top-level canvas and the canvas
 * of each task/subtask. Returns a shallow copy; the stored record is untouched.
 */
export const redactWorkspaceForRole = (workspace, role) => {
  if (!workspace || typeof workspace !== 'object') return workspace;
  const normalized = normalizeRole(role);
  if (!normalized) return workspace;

  const out = { ...workspace };

  if (Array.isArray(out.nodes)) {
    out.nodes = redactNodesForRole(out.nodes, normalized);
  }

  if (Array.isArray(out.tasks)) {
    out.tasks = out.tasks.map((task) => {
      if (!task || !Array.isArray(task.subtasks)) return task;
      return {
        ...task,
        subtasks: task.subtasks.map((subtask) => {
          if (!subtask?.canvasData || !Array.isArray(subtask.canvasData.nodes)) return subtask;
          return {
            ...subtask,
            canvasData: {
              ...subtask.canvasData,
              nodes: redactNodesForRole(subtask.canvasData.nodes, normalized),
            },
          };
        }),
      };
    });
  }

  return out;
};

/**
 * Merge back nodes the writer is not allowed to see. Their payload omits those
 * nodes, so without this a save from a restricted role would delete them.
 * Incoming nodes always win for the ids the writer can see.
 */
export const preserveHiddenNodes = (existingNodes, incomingNodes, role) => {
  const incoming = Array.isArray(incomingNodes) ? incomingNodes : [];
  const normalized = normalizeRole(role);
  if (!normalized || !Array.isArray(existingNodes)) return incoming;

  const incomingIds = new Set(incoming.map((node) => node?.id).filter(Boolean));
  const hidden = existingNodes.filter(
    (node) => node?.id && !incomingIds.has(node.id) && !canRoleSeeNode(node?.data, normalized)
  );

  return hidden.length > 0 ? [...incoming, ...hidden] : incoming;
};

/** Same as preserveHiddenNodes but for a subtask canvas envelope. */
export const preserveHiddenSubtaskNodes = (existingSubtask, incomingCanvasData, role) => {
  const incoming = incomingCanvasData && typeof incomingCanvasData === 'object' ? incomingCanvasData : {};
  const existingNodes = existingSubtask?.canvasData?.nodes;
  const merged = preserveHiddenNodes(existingNodes, incoming.nodes, role);
  return { ...incoming, nodes: merged };
};
