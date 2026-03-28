import { QueryCommand, GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';
import { canManageUser } from '../utils/permission.utils.js';
import { canAccessProject, canAccessWorkspace, sanitizeScopeIds, resolveAccessScopesForRole } from '../utils/scopeAccess.utils.js';
import * as DynamoProject from '../../pm/models/DynamoProject.js';
import * as DynamoWorkspace from '../../workspace/models/DynamoWorkspace.js';
import crypto from 'crypto';

export async function getProjectMemberAccess(req, res) {
  try {
    const { orgId } = req.rbac;
    const projectId = String(req.params.id || '').trim();
    const project = await DynamoProject.getProjectById(projectId);
    // Some project cards are sourced from lead flows and may not exist in PROJECTS_TABLE.
    // In that case, use the incoming ID as the scope key.
    const resolvedProjectId = project?.projectId || project?.id || projectId;
    if (!canAccessProject(req.rbac, resolvedProjectId)) {
      return res.status(403).json({ error: 'Access denied for this project' });
    }
    const members = await listActiveMembers(orgId);
    const payload = members.map((member) => {
      const projectAccess = sanitizeScopeIds(member.projectAccess);
      return {
        userId: member.userId,
        email: member.email,
        roleId: member.roleId,
        roleName: member.roleName,
        status: member.status,
        projectAccess,
        workspaceAccess: sanitizeScopeIds(member.workspaceAccess),
        hasAccess: projectAccess.includes('*') || projectAccess.includes(resolvedProjectId),
      };
    });
    return res.status(200).json({
      projectId: resolvedProjectId,
      members: payload,
      total: payload.length,
    });
  } catch (error) {
    console.error('[RBAC] getProjectMemberAccess error:', error);
    return res.status(500).json({ error: 'Failed to fetch project member access' });
  }
}

export async function updateProjectMemberAccess(req, res) {
  return updateMemberAccessByResource(req, res, 'project');
}

export async function getWorkspaceMemberAccess(req, res) {
  try {
    const { orgId } = req.rbac;
    const workspaceId = String(req.params.id || '').trim();
    const workspace = await DynamoWorkspace.getWorkspaceById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    const resolvedWorkspaceId = workspace.workspaceId || workspace.id || workspaceId;
    if (!canAccessWorkspace(req.rbac, resolvedWorkspaceId, workspace.projectId)) {
      return res.status(403).json({ error: 'Access denied for this workspace' });
    }
    const members = await listActiveMembers(orgId);
    const payload = members.map((member) => {
      const workspaceAccess = sanitizeScopeIds(member.workspaceAccess);
      return {
        userId: member.userId,
        email: member.email,
        roleId: member.roleId,
        roleName: member.roleName,
        status: member.status,
        projectAccess: sanitizeScopeIds(member.projectAccess),
        workspaceAccess,
        hasAccess: workspaceAccess.includes('*') || workspaceAccess.includes(resolvedWorkspaceId),
      };
    });
    return res.status(200).json({
      workspaceId: resolvedWorkspaceId,
      projectId: workspace.projectId || null,
      members: payload,
      total: payload.length,
    });
  } catch (error) {
    console.error('[RBAC] getWorkspaceMemberAccess error:', error);
    return res.status(500).json({ error: 'Failed to fetch workspace member access' });
  }
}

export async function updateWorkspaceMemberAccess(req, res) {
  return updateMemberAccessByResource(req, res, 'workspace');
}

async function updateMemberAccessByResource(req, res, resourceType) {
  try {
    const { orgId, userId: callerId, roleLevel: callerLevel } = req.rbac;
    const resourceId = String(req.params.id || '').trim();
    const addUserIds = sanitizeSubjectIds(req.body?.addUserIds);
    const removeUserIds = sanitizeSubjectIds(req.body?.removeUserIds);
    const reason = String(req.body?.reason || '').trim();
    if (addUserIds.length === 0 && removeUserIds.length === 0) {
      return res.status(400).json({ error: 'addUserIds or removeUserIds is required' });
    }
    const resourceCheck = await resolveResourceAccess(req, resourceType, resourceId);
    if (!resourceCheck.ok) {
      return res.status(resourceCheck.status).json({ error: resourceCheck.error });
    }
    const targetUserIds = [...new Set([...addUserIds, ...removeUserIds])];
    if (targetUserIds.includes(callerId)) {
      return res.status(403).json({ error: 'You cannot modify your own access scope from this endpoint' });
    }
    const memberMap = await buildMemberMap(orgId);
    const missing = targetUserIds.filter((userId) => !memberMap.has(userId));
    if (missing.length > 0) {
      return res.status(404).json({
        error: 'One or more members were not found',
        missingUserIds: missing,
      });
    }
    const roleLevelCache = new Map();
    for (const userId of targetUserIds) {
      const member = memberMap.get(userId);
      const targetRoleLevel = await getRoleLevel(orgId, member.roleId, roleLevelCache);
      if (!canManageUser(callerLevel, targetRoleLevel)) {
        return res.status(403).json({
          error: 'Insufficient authority',
          message: `Cannot manage member ${member.email || userId} with equal or higher authority.`,
        });
      }
    }
    const addSet = new Set(addUserIds);
    const removeSet = new Set(removeUserIds);
    const now = new Date().toISOString();
    const updatedMembers = [];
    for (const userId of targetUserIds) {
      const member = memberMap.get(userId);
      const currentProjectAccess = sanitizeScopeIds(member.projectAccess);
      const currentWorkspaceAccess = sanitizeScopeIds(member.workspaceAccess);
      let nextProjectAccess = currentProjectAccess;
      let nextWorkspaceAccess = currentWorkspaceAccess;
      if (resourceType === 'project') {
        nextProjectAccess = mutateResourceList(currentProjectAccess, resourceId, addSet.has(userId), removeSet.has(userId));
      } else {
        nextWorkspaceAccess = mutateResourceList(currentWorkspaceAccess, resourceId, addSet.has(userId), removeSet.has(userId));
      }
      const scopedByRole = resolveAccessScopesForRole(member.roleId, nextProjectAccess, nextWorkspaceAccess);
      await docClient.send(new UpdateCommand({
        TableName: TABLES.MEMBERS,
        Key: { orgId, userId },
        UpdateExpression: 'SET projectAccess = :projectAccess, workspaceAccess = :workspaceAccess, updatedAt = :now',
        ExpressionAttributeValues: {
          ':projectAccess': scopedByRole.projectAccess,
          ':workspaceAccess': scopedByRole.workspaceAccess,
          ':now': now,
        },
      }));
      updatedMembers.push({
        userId,
        email: member.email,
        roleId: member.roleId,
        projectAccess: scopedByRole.projectAccess,
        workspaceAccess: scopedByRole.workspaceAccess,
        forcedScopeByRole: scopedByRole.forced,
      });
    }
    await logAudit(
      orgId,
      callerId,
      resourceType === 'project' ? 'PROJECT_MEMBER_ACCESS_UPDATED' : 'WORKSPACE_MEMBER_ACCESS_UPDATED',
      {
        resourceId,
        addUserIds,
        removeUserIds,
        reason: reason || null,
        updatedCount: updatedMembers.length,
      },
      req.auth?.email
    );
    return res.status(200).json({
      success: true,
      resourceType,
      resourceId,
      updatedCount: updatedMembers.length,
      members: updatedMembers,
    });
  } catch (error) {
    console.error('[RBAC] updateMemberAccessByResource error:', error);
    return res.status(500).json({ error: 'Failed to update resource member access' });
  }
}

async function resolveResourceAccess(req, resourceType, resourceId) {
  if (resourceType === 'project') {
    const project = await DynamoProject.getProjectById(resourceId);
    const resolvedProjectId = project?.projectId || project?.id || resourceId;
    if (!canAccessProject(req.rbac, resolvedProjectId)) {
      return { ok: false, status: 403, error: 'Access denied for this project' };
    }
    return { ok: true };
  }
  const workspace = await DynamoWorkspace.getWorkspaceById(resourceId);
  if (!workspace) return { ok: false, status: 404, error: 'Workspace not found' };
  const resolvedWorkspaceId = workspace.workspaceId || workspace.id || resourceId;
  if (!canAccessWorkspace(req.rbac, resolvedWorkspaceId, workspace.projectId)) {
    return { ok: false, status: 403, error: 'Access denied for this workspace' };
  }
  return { ok: true };
}

function mutateResourceList(existingIds, resourceId, shouldAdd, shouldRemove) {
  if (existingIds.includes('*')) return ['*'];
  const idSet = new Set(existingIds);
  if (shouldAdd) idSet.add(resourceId);
  if (shouldRemove) idSet.delete(resourceId);
  return [...idSet];
}

function sanitizeSubjectIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean))];
}

async function listActiveMembers(orgId) {
  const items = [];
  let exclusiveStartKey;
  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLES.MEMBERS,
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
      ExclusiveStartKey: exclusiveStartKey,
      Limit: 100,
    }));
    items.push(...(result.Items || []).filter((member) => member.status !== 'removed'));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

async function buildMemberMap(orgId) {
  const members = await listActiveMembers(orgId);
  const map = new Map();
  for (const member of members) {
    if (member?.userId) {
      map.set(member.userId, member);
    }
  }
  return map;
}

async function getRoleLevel(orgId, roleId, cache) {
  const cacheKey = `${orgId}:${roleId}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const roleResult = await docClient.send(new GetCommand({
    TableName: TABLES.ROLES,
    Key: { orgId, roleId },
    ProjectionExpression: 'roleLevel',
  }));
  const roleLevel = roleResult.Item?.roleLevel ?? 999;
  cache.set(cacheKey, roleLevel);
  return roleLevel;
}

async function logAudit(orgId, userId, action, details = {}, actorEmail = null) {
  try {
    const eventId = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const item = {
      orgId,
      eventId,
      userId,
      action,
      details,
      timestamp: new Date().toISOString(),
    };
    if (actorEmail) item.actorEmail = actorEmail;
    await docClient.send(new PutCommand({
      TableName: TABLES.AUDIT_LOG,
      Item: item,
    }));
  } catch (error) {
    console.error('[RBAC] Audit log error:', error?.message);
  }
}