// ============================================================
// FILE: rbacRoutes.js
// PURPOSE: API routes for RBAC operations.
//          Phase 1: GET /me
//          Phase 2: Members CRUD, roles CRUD, invitations
// CONNECTS TO: meController, membersController, rolesController,
//              invitationsController, attachRBAC, requirePermission
// ============================================================

import { Router } from 'express';
import { getMyRBAC } from '../controllers/meController.js';
import { listMembers, inviteMember, changeMemberRole, removeMember, suspendMember, unsuspendMember, updateMemberAccessScopes } from '../controllers/membersController.js';
import { listRoles, getRoleDetails, createRole, updateRole, deleteRole } from '../controllers/rolesController.js';
import { listInvitations, cancelInvitation } from '../controllers/invitationsController.js';
import { validateInviteToken, acceptInvitation } from '../controllers/inviteAcceptController.js';
import { getAuditLogs } from '../controllers/auditLogController.js';
import { listPermissions, listPlatforms } from '../controllers/permissionsController.js';
import { attachRBAC } from '../middleware/attachRBAC.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { authenticateCognitoJwt } from '../../../middleware/cognitoJwtMiddleware.js';
import { attachVendorId } from '../../../middleware/attachVendorId.js';

const router = Router();

// ──────────────────────────────────────
// Public invite routes (must stay unauthenticated)
// Keep these before auth middleware to guarantee invite acceptance
// works even if mount order differs across environments.
// ──────────────────────────────────────

/** GET /api/rbac/invite/validate?token=... */
router.get('/invite/validate', validateInviteToken);

/** POST /api/rbac/invite/accept */
router.post('/invite/accept', acceptInvitation);

// ──────────────────────────────────────
// Auth → VendorId → RBAC pipeline applied to all RBAC routes.
// attachVendorId resolves req.vendorId from email (EmailIndex Query).
// attachRBAC reads req.vendorId to find org → loads role + permissions.
// ──────────────────────────────────────
router.use(authenticateCognitoJwt);
router.use(attachVendorId);
router.use(attachRBAC);

// ──────────────────────────────────────
// Phase 1 — Current user's RBAC context
// ──────────────────────────────────────

/** GET /api/rbac/me — current user's role, permissions, org info */
router.get('/me', getMyRBAC);

// ──────────────────────────────────────
// Phase 2 — Members CRUD
// ──────────────────────────────────────

/** GET /api/rbac/members — list org members */
router.get('/members', requirePermission('user_management', 'view'), listMembers);

/** POST /api/rbac/members/invite — invite a new member */
router.post('/members/invite', requirePermission('user_management', 'create'), inviteMember);

/** PATCH /api/rbac/members/:userId/role — change a member's role */
router.patch('/members/:userId/role', requirePermission('user_management', 'edit'), changeMemberRole);

/** PATCH /api/rbac/members/:userId/access-scopes — update member project/workspace scopes */
router.patch('/members/:userId/access-scopes', requirePermission('user_management', 'edit'), updateMemberAccessScopes);

/** DELETE /api/rbac/members/:userId — remove a member */
router.delete('/members/:userId', requirePermission('user_management', 'edit'), removeMember);

/** POST /api/rbac/members/:userId/suspend — suspend a member */
router.post('/members/:userId/suspend', requirePermission('user_management', 'edit'), suspendMember);

/** POST /api/rbac/members/:userId/unsuspend — unsuspend a member */
router.post('/members/:userId/unsuspend', requirePermission('user_management', 'edit'), unsuspendMember);

// ──────────────────────────────────────
// Phase 2.5 — Role Management (CRUD)
// ──────────────────────────────────────

/** GET /api/rbac/roles — list all roles + meta (limits, suggestions) */
router.get('/roles', requirePermission('user_management', 'view'), listRoles);

/** GET /api/rbac/roles/:roleId — full role details with permissions */
router.get('/roles/:roleId', requirePermission('user_management', 'view'), getRoleDetails);

/** POST /api/rbac/roles — create a custom role */
router.post('/roles', requirePermission('user_management', 'manage'), createRole);

/** PUT /api/rbac/roles/:roleId — update role name/description/permissions */
router.put('/roles/:roleId', requirePermission('user_management', 'manage'), updateRole);

/** DELETE /api/rbac/roles/:roleId — delete a custom role */
router.delete('/roles/:roleId', requirePermission('user_management', 'manage'), deleteRole);

// ──────────────────────────────────────
// Phase 2 — Invitations
// ──────────────────────────────────────

/** GET /api/rbac/invitations — list pending invitations */
router.get('/invitations', requirePermission('user_management', 'view'), listInvitations);

/** DELETE /api/rbac/invitations/:inviteId — cancel a pending invitation */
router.delete('/invitations/:inviteId', requirePermission('user_management', 'edit'), cancelInvitation);

// ──────────────────────────────────────
// Phase 3 — Permissions Catalog
// ──────────────────────────────────────

/** GET /api/rbac/permissions?platform=vendor — list all available permissions for a platform */
router.get('/permissions', requirePermission('user_management', 'view'), listPermissions);

/** GET /api/rbac/permissions/platforms — list all platform metadata (for invite modal) */
router.get('/permissions/platforms', requirePermission('user_management', 'view'), listPlatforms);

// ──────────────────────────────────────
// Activity / Audit Logs
// ──────────────────────────────────────

/** GET /api/rbac/audit-logs — activity logs (hierarchy-filtered) */
router.get('/audit-logs', getAuditLogs);

export default router;
