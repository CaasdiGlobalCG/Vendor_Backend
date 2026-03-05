// ============================================================
// FILE: rolesController.js
// PURPOSE: Full CRUD for organization roles — list, detail, create,
//          update permissions, delete. Supports both system and custom roles.
// CONNECTS TO: rbac_roles table, rbac_members table (member-count guard),
//              rbac_organizations table (plan limit check),
//              modules.js (permission validation), plans.js (role limits)
// ============================================================

import {
  QueryCommand, GetCommand, PutCommand, UpdateCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { docClient } from '../config/db.js';
import { TABLES } from '../config/tables.js';
import { VENDOR_MODULES, CLIENT_MODULES, getAllPermissions } from '../config/modules.js';
import { canManageUser } from '../utils/permission.utils.js';

/* ── helpers ────────────────────────────────────────────── */

/** Get the org record to read subscription plan info. */
async function getOrg(orgId) {
  const { Item } = await docClient.send(new GetCommand({
    TableName: TABLES.ORGANIZATIONS,
    Key: { orgId },
  }));
  return Item;
}

/** Count existing custom roles for an org. */
async function countCustomRoles(orgId) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLES.ROLES,
    KeyConditionExpression: 'orgId = :orgId',
    FilterExpression: 'isSystem = :f',
    ExpressionAttributeValues: { ':orgId': orgId, ':f': false },
    Select: 'COUNT',
  }));
  return result.Count || 0;
}

/** Count members assigned to a specific role in an org. */
async function countMembersWithRole(orgId, roleId) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLES.MEMBERS,
    KeyConditionExpression: 'orgId = :orgId',
    FilterExpression: 'roleId = :r AND #st <> :removed',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: {
      ':orgId': orgId, ':r': roleId, ':removed': 'removed',
    },
    Select: 'COUNT',
  }));
  return result.Count || 0;
}

/**
 * Validate permissions against the module registry.
 * Returns { valid, invalid } arrays.
 */
function validatePermissions(permissions, orgType) {
  const registry = orgType === 'client' ? CLIENT_MODULES : VENDOR_MODULES;
  const validPerms = getAllPermissions(registry);
  const valid = [];
  const invalid = [];
  for (const p of permissions) {
    if (p === '*:*') { invalid.push(p); continue; } // Only system super_admin gets wildcard
    if (validPerms.has(p)) { valid.push(p); } else { invalid.push(p); }
  }
  return { valid, invalid };
}

/** Max custom role limits per plan (fallback if plan not found). */
const DEFAULT_LIMITS = { vendor: 8, client: 4 };
const PLAN_LIMITS = {
  free:       { vendor: 8,    client: 4 },
  pro:        { vendor: 20,   client: 12 },
  enterprise: { vendor: 9999, client: 9999 },
};

function getMaxCustomRoles(plan, orgType) {
  const limits = PLAN_LIMITS[plan] || DEFAULT_LIMITS;
  return limits[orgType] ?? DEFAULT_LIMITS[orgType] ?? 8;
}

/** Fire-and-forget audit log entry. */
function logAudit(orgId, userId, action, details, actorEmail = null) {
  const now = new Date().toISOString();
  const item = {
    orgId,
    eventId: `${now}#${randomUUID()}`,
    userId,
    action,
    module: 'user_management',
    details,
    timestamp: now,
    ttl: Math.floor(Date.now() / 1000) + 365 * 86400,
  };
  if (actorEmail) item.actorEmail = actorEmail;
  docClient.send(new PutCommand({
    TableName: TABLES.AUDIT_LOG,
    Item: item,
  })).catch((e) => console.error('[RBAC] audit log error:', e.message));
}

/* ── role name suggestions (for frontend dropdown) ─────── */

const VENDOR_ROLE_SUGGESTIONS = [
  'Sales Manager', 'Operations Manager', 'Accountant',
  'Finance Manager', 'Warehouse Manager', 'Support Agent',
  'Marketing Lead', 'HR Manager', 'Project Manager',
  'Quality Inspector', 'Logistics Coordinator',
];
const CLIENT_ROLE_SUGGESTIONS = [
  'Procurement Lead', 'Project Coordinator', 'Finance Officer',
  'Warehouse Supervisor', 'Quality Assurance', 'Logistics Manager',
];

/* ══════════════════════════════════════════════════════════
 * GET /api/rbac/roles
 * List all roles for the current org.
 * Returns system + custom roles with full permissions array.
 * ══════════════════════════════════════════════════════════ */
export async function listRoles(req, res) {
  try {
    const { orgId, roleLevel: callerLevel, orgType } = req.rbac;

    const result = await docClient.send(new QueryCommand({
      TableName: TABLES.ROLES,
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
    }));

    const roles = (result.Items || [])
      .sort((a, b) => (a.roleLevel ?? 99) - (b.roleLevel ?? 99))
      .map((role) => ({
        roleId:          role.roleId,
        roleName:        role.roleName,
        roleLevel:       role.roleLevel,
        isSystem:        role.isSystem ?? true,
        description:     role.description || '',
        permissions:     role.permissions || [],
        permissionCount: role.permissions?.length || 0,
        createdBy:       role.createdBy || null,
        createdAt:       role.createdAt || null,
        // caller can assign roles BELOW their level
        canAssign: callerLevel < (role.roleLevel ?? 99),
        // caller can edit roles BELOW their level (not level 0)
        canEdit: callerLevel < (role.roleLevel ?? 99) && (role.roleLevel ?? 0) > 0,
      }));

    // Include suggestions & limits metadata for the frontend create-role form
    const org = await getOrg(orgId);
    const customCount = roles.filter((r) => !r.isSystem).length;
    const maxCustom = getMaxCustomRoles(org?.subscriptionPlan || 'free', orgType);

    return res.status(200).json({
      roles,
      meta: {
        customRoleCount: customCount,
        maxCustomRoles:  maxCustom,
        canCreateMore:   customCount < maxCustom,
        suggestions:     orgType === 'client' ? CLIENT_ROLE_SUGGESTIONS : VENDOR_ROLE_SUGGESTIONS,
      },
    });
  } catch (error) {
    console.error('[RBAC] listRoles error:', error);
    return res.status(500).json({ error: 'Failed to list roles' });
  }
}

/* ══════════════════════════════════════════════════════════
 * GET /api/rbac/roles/:roleId
 * Get full details for a single role (including permissions).
 * Used to populate the edit-role form or the invite-preview.
 * ══════════════════════════════════════════════════════════ */
export async function getRoleDetails(req, res) {
  try {
    const { orgId } = req.rbac;
    const { roleId } = req.params;

    const { Item: role } = await docClient.send(new GetCommand({
      TableName: TABLES.ROLES,
      Key: { orgId, roleId },
    }));

    if (!role) {
      return res.status(404).json({ error: 'Role not found', code: 'RBAC_ROLE_001' });
    }

    const memberCount = await countMembersWithRole(orgId, roleId);

    return res.status(200).json({
      role: {
        roleId:      role.roleId,
        roleName:    role.roleName,
        roleLevel:   role.roleLevel,
        isSystem:    role.isSystem ?? true,
        description: role.description || '',
        permissions: role.permissions || [],
        createdBy:   role.createdBy || null,
        createdAt:   role.createdAt || null,
        updatedAt:   role.updatedAt || null,
      },
      memberCount,
    });
  } catch (error) {
    console.error('[RBAC] getRoleDetails error:', error);
    return res.status(500).json({ error: 'Failed to get role details' });
  }
}

/* ══════════════════════════════════════════════════════════
 * POST /api/rbac/roles
 * Create a new custom role.
 *
 * Body: { roleName, roleLevel, description?, permissions[], copyFrom? }
 * - copyFrom: optional roleId to clone permissions from before applying
 *   the provided permissions (if empty, uses cloned set as-is).
 * ══════════════════════════════════════════════════════════ */
export async function createRole(req, res) {
  try {
    const { orgId, roleLevel: callerLevel, orgType, userId } = req.rbac;
    const { roleName, roleLevel, description, permissions, copyFrom } = req.body;

    /* --- basic validation --- */
    if (!roleName || typeof roleName !== 'string' || !roleName.trim()) {
      return res.status(400).json({ error: 'roleName is required', code: 'RBAC_ROLE_002' });
    }
    if (roleLevel == null || typeof roleLevel !== 'number' || roleLevel < 1 || roleLevel > 4) {
      return res.status(400).json({
        error: 'roleLevel must be 1-4 (cannot create level 0 = Super Admin)',
        code: 'RBAC_ROLE_003',
      });
    }

    /* --- hierarchy check: caller must be strictly above target level --- */
    if (!canManageUser(callerLevel, roleLevel)) {
      return res.status(403).json({
        error: 'Cannot create a role at or above your own level',
        code: 'RBAC_ROLE_004',
      });
    }

    /* --- plan limit check --- */
    const org = await getOrg(orgId);
    const maxCustom = getMaxCustomRoles(org?.subscriptionPlan || 'free', orgType);
    const currentCount = await countCustomRoles(orgId);
    if (currentCount >= maxCustom) {
      return res.status(403).json({
        error: `Custom role limit reached (${maxCustom}). Upgrade your plan for more.`,
        code: 'RBAC_ROLE_005',
      });
    }

    /* --- resolve permissions (copy-from or explicit) --- */
    let finalPermissions = [];

    if (copyFrom) {
      // Clone permissions from an existing role
      const { Item: sourceRole } = await docClient.send(new GetCommand({
        TableName: TABLES.ROLES,
        Key: { orgId, roleId: copyFrom },
      }));
      if (!sourceRole) {
        return res.status(404).json({ error: 'Source role (copyFrom) not found', code: 'RBAC_ROLE_006' });
      }
      // Start from cloned set, then overlay if caller provided explicit permissions
      finalPermissions = [...(sourceRole.permissions || [])];
      // Never copy wildcard
      finalPermissions = finalPermissions.filter((p) => p !== '*:*');
    }

    // If explicit permissions provided, they REPLACE the copied set
    if (Array.isArray(permissions) && permissions.length > 0) {
      finalPermissions = permissions;
    }

    /* --- validate every permission string --- */
    const { valid, invalid } = validatePermissions(finalPermissions, orgType);
    if (invalid.length > 0) {
      return res.status(400).json({
        error: `Invalid permissions: ${invalid.join(', ')}`,
        code: 'RBAC_ROLE_007',
      });
    }

    /* --- generate roleId (slug from name + short uuid) --- */
    const slug = roleName.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const roleId = `${slug}_${randomUUID().slice(0, 8)}`;

    const now = new Date().toISOString();
    const roleItem = {
      orgId,
      roleId,
      roleName: roleName.trim(),
      roleLevel,
      isSystem: false,
      description: (description || '').trim(),
      permissions: valid,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    await docClient.send(new PutCommand({
      TableName: TABLES.ROLES,
      Item: roleItem,
      ConditionExpression: 'attribute_not_exists(orgId)',
    }));

    logAudit(orgId, userId, 'role.created', {
      roleId, roleName: roleName.trim(), roleLevel,
      permissionCount: valid.length, copiedFrom: copyFrom || null,
    }, req.auth?.email);

    return res.status(201).json({ role: roleItem });
  } catch (error) {
    console.error('[RBAC] createRole error:', error);
    return res.status(500).json({ error: 'Failed to create role' });
  }
}

/* ══════════════════════════════════════════════════════════
 * PUT /api/rbac/roles/:roleId
 * Update a role's name, description, and/or permissions.
 *
 * System roles: only permissions + description can be changed
 *               (roleName + roleLevel are locked).
 * Custom roles: all fields are editable.
 *
 * Hierarchy: caller's roleLevel must be strictly lower (higher authority)
 *            than the role being edited. Level 0 (Super Admin) is immutable.
 *
 * Body: { roleName?, description?, permissions? }
 * ══════════════════════════════════════════════════════════ */
export async function updateRole(req, res) {
  try {
    const { orgId, roleLevel: callerLevel, orgType, userId } = req.rbac;
    const { roleId } = req.params;
    const { roleName, description, permissions } = req.body;

    /* --- fetch existing role --- */
    const { Item: existingRole } = await docClient.send(new GetCommand({
      TableName: TABLES.ROLES,
      Key: { orgId, roleId },
    }));
    if (!existingRole) {
      return res.status(404).json({ error: 'Role not found', code: 'RBAC_ROLE_001' });
    }

    /* --- Super Admin role is fully immutable --- */
    if ((existingRole.roleLevel ?? 99) === 0) {
      return res.status(403).json({
        error: 'Super Admin role cannot be modified',
        code: 'RBAC_ROLE_008',
      });
    }

    /* --- hierarchy: caller must outrank the role being edited --- */
    if (!canManageUser(callerLevel, existingRole.roleLevel)) {
      return res.status(403).json({
        error: 'Cannot edit a role at or above your own level',
        code: 'RBAC_ROLE_004',
      });
    }

    /* --- build update expression dynamically --- */
    const expNames = {};
    const expValues = {};
    const setClauses = ['#updatedAt = :now'];
    expNames['#updatedAt'] = 'updatedAt';
    expValues[':now'] = new Date().toISOString();

    // description — always editable
    if (description !== undefined) {
      setClauses.push('#desc = :desc');
      expNames['#desc'] = 'description';
      expValues[':desc'] = (description || '').trim();
    }

    // roleName — only for custom roles
    if (roleName !== undefined) {
      if (existingRole.isSystem) {
        return res.status(400).json({
          error: 'Cannot rename a system role',
          code: 'RBAC_ROLE_009',
        });
      }
      if (!roleName.trim()) {
        return res.status(400).json({ error: 'roleName cannot be empty', code: 'RBAC_ROLE_002' });
      }
      setClauses.push('#rn = :rn');
      expNames['#rn'] = 'roleName';
      expValues[':rn'] = roleName.trim();
    }

    // permissions — validate against module registry
    if (permissions !== undefined) {
      if (!Array.isArray(permissions)) {
        return res.status(400).json({ error: 'permissions must be an array', code: 'RBAC_ROLE_010' });
      }
      const { valid, invalid } = validatePermissions(permissions, orgType);
      if (invalid.length > 0) {
        return res.status(400).json({
          error: `Invalid permissions: ${invalid.join(', ')}`,
          code: 'RBAC_ROLE_007',
        });
      }
      setClauses.push('#perms = :perms');
      expNames['#perms'] = 'permissions';
      expValues[':perms'] = valid;
    }

    await docClient.send(new UpdateCommand({
      TableName: TABLES.ROLES,
      Key: { orgId, roleId },
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ExpressionAttributeNames: expNames,
      ExpressionAttributeValues: expValues,
    }));

    logAudit(orgId, userId, 'role.updated', {
      roleId,
      fieldsChanged: Object.keys(req.body),
      newPermissionCount: permissions?.length ?? null,
    }, req.auth?.email);

    return res.status(200).json({ message: 'Role updated successfully', roleId });
  } catch (error) {
    console.error('[RBAC] updateRole error:', error);
    return res.status(500).json({ error: 'Failed to update role' });
  }
}

/* ══════════════════════════════════════════════════════════
 * DELETE /api/rbac/roles/:roleId
 * Delete a custom role. System roles cannot be deleted.
 * Fails if any active members are still assigned to this role.
 *
 * Hierarchy: caller must outrank the role being deleted.
 * ══════════════════════════════════════════════════════════ */
export async function deleteRole(req, res) {
  try {
    const { orgId, roleLevel: callerLevel, userId } = req.rbac;
    const { roleId } = req.params;

    /* --- fetch existing role --- */
    const { Item: existingRole } = await docClient.send(new GetCommand({
      TableName: TABLES.ROLES,
      Key: { orgId, roleId },
    }));
    if (!existingRole) {
      return res.status(404).json({ error: 'Role not found', code: 'RBAC_ROLE_001' });
    }

    /* --- system roles cannot be deleted --- */
    if (existingRole.isSystem) {
      return res.status(403).json({
        error: 'System roles cannot be deleted',
        code: 'RBAC_ROLE_011',
      });
    }

    /* --- hierarchy check --- */
    if (!canManageUser(callerLevel, existingRole.roleLevel)) {
      return res.status(403).json({
        error: 'Cannot delete a role at or above your own level',
        code: 'RBAC_ROLE_004',
      });
    }

    /* --- guard: cannot delete if members are assigned --- */
    const memberCount = await countMembersWithRole(orgId, roleId);
    if (memberCount > 0) {
      return res.status(409).json({
        error: `Cannot delete role — ${memberCount} member(s) still assigned. Reassign them first.`,
        code: 'RBAC_ROLE_012',
      });
    }

    await docClient.send(new DeleteCommand({
      TableName: TABLES.ROLES,
      Key: { orgId, roleId },
    }));

    logAudit(orgId, userId, 'role.deleted', {
      roleId, roleName: existingRole.roleName,
    }, req.auth?.email);

    return res.status(200).json({ message: 'Role deleted successfully', roleId });
  } catch (error) {
    console.error('[RBAC] deleteRole error:', error);
    return res.status(500).json({ error: 'Failed to delete role' });
  }
}
