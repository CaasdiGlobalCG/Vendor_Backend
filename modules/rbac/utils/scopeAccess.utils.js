// ============================================================
// FILE: scopeAccess.utils.js
// PURPOSE: Shared helpers for project/workspace scoped access checks.
// CONNECTS TO: attachRBAC.js, meController.js, project/workspace controllers
// ============================================================

const FORCE_FULL_SCOPE_ROLE_IDS = new Set(['super_admin', 'admin']);

/**
 * Normalizes incoming scope arrays from DynamoDB member records.
 * Supports wildcard values to grant full access.
 *
 * @param {string[]|undefined|null} projectIds
 * @param {string[]|undefined|null} workspaceIds
 * @returns {{ projectIds: string[], workspaceIds: string[], allowAllProjects: boolean, allowAllWorkspaces: boolean }}
 */
export function normalizeScopeAccess(projectIds, workspaceIds) {
  const projects = Array.isArray(projectIds)
    ? projectIds.filter((id) => typeof id === 'string' && id.trim())
    : [];
  const workspaces = Array.isArray(workspaceIds)
    ? workspaceIds.filter((id) => typeof id === 'string' && id.trim())
    : [];

  const allowAllProjects = projects.includes('*');
  const allowAllWorkspaces = workspaces.includes('*');

  return {
    projectIds: allowAllProjects ? ['*'] : [...new Set(projects)],
    workspaceIds: allowAllWorkspaces ? ['*'] : [...new Set(workspaces)],
    allowAllProjects,
    allowAllWorkspaces,
  };
}

/**
 * Returns true if the user can access the provided project.
 * Super admins and users with no explicit scope restrictions are allowed.
 *
 * @param {Object|null} rbac
 * @param {string|undefined|null} projectId
 * @returns {boolean}
 */
export function canAccessProject(rbac, projectId) {
  if (!rbac) return false;
  if (rbac.isSuperAdmin) return true;
  if (!projectId) return true;

  const scopes = rbac.accessScopes;
  if (!scopes) return true;
  if (scopes.allowAllProjects) return true;

  const projectIds = Array.isArray(scopes.projectIds) ? scopes.projectIds : [];
  if (projectIds.length === 0) {
    // If workspace scope is explicitly constrained, do not grant blanket project access.
    if (!scopes.allowAllWorkspaces && Array.isArray(scopes.workspaceIds) && scopes.workspaceIds.length > 0) {
      return false;
    }
    return true;
  }

  return projectIds.includes(projectId);
}

/**
 * Returns true if the user can access the provided workspace.
 * Workspace access can come from direct workspace scope or inherited project scope.
 *
 * @param {Object|null} rbac
 * @param {string|undefined|null} workspaceId
 * @param {string|undefined|null} projectId
 * @returns {boolean}
 */
export function canAccessWorkspace(rbac, workspaceId, projectId) {
  if (!rbac) return false;
  if (rbac.isSuperAdmin) return true;

  const scopes = rbac.accessScopes;
  if (!scopes) return true;

  if (scopes.allowAllWorkspaces) return true;
  if (workspaceId && Array.isArray(scopes.workspaceIds) && scopes.workspaceIds.includes(workspaceId)) {
    return true;
  }

  return canAccessProject(rbac, projectId);
}

/**
 * Strips and deduplicates scope IDs for write APIs.
 *
 * @param {string[]|undefined|null} ids
 * @returns {string[]}
 */
export function sanitizeScopeIds(ids) {
  if (!Array.isArray(ids)) return [];
  const clean = ids
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);

  if (clean.includes('*')) return ['*'];
  return [...new Set(clean)];
}

/**
 * Returns normalized project/workspace scopes with role-based wildcard enforcement.
 *
 * @param {string} roleId
 * @param {string[]|undefined|null} projectIds
 * @param {string[]|undefined|null} workspaceIds
 * @returns {{ projectAccess: string[], workspaceAccess: string[], forced: boolean }}
 */
export function resolveAccessScopesForRole(roleId, projectIds = [], workspaceIds = []) {
  const normalizedRoleId = String(roleId || '').toLowerCase();
  if (FORCE_FULL_SCOPE_ROLE_IDS.has(normalizedRoleId)) {
    return { projectAccess: ['*'], workspaceAccess: ['*'], forced: true };
  }

  return {
    projectAccess: sanitizeScopeIds(projectIds),
    workspaceAccess: sanitizeScopeIds(workspaceIds),
    forced: false,
  };
}
