# RBAC Module — Vendor Backend Context

## Overview
Role-Based Access Control (RBAC) module for the Vendor Backend.
Phase 1 operates in **permissive mode** — logs permission mismatches but doesn't block requests.

## Directory Structure
```
modules/rbac/
├── index.js                    ← Barrel export (routes + middleware + config + utils)
├── config/
│   ├── modules.js              ← Module registry (THE extensibility point)
│   ├── roles.js                ← Default role definitions with permissions
│   ├── tables.js               ← DynamoDB table name constants
│   ├── plans.js                ← Subscription plan definitions
│   └── db.js                   ← SDK v3 DynamoDB client for RBAC
├── middleware/
│   ├── attachRBAC.js           ← Loads user's role + permissions onto req.rbac
│   └── requirePermission.js    ← Route-level permission guard factory
├── controllers/
│   ├── meController.js         ← GET /api/rbac/me handler
│   ├── membersController.js    ← listMembers, inviteMember, changeMemberRole, removeMember
│   ├── rolesController.js      ← listRoles with canAssign flag
│   └── invitationsController.js ← listInvitations, cancelInvitation
├── routes/
│   └── rbacRoutes.js           ← Express router (Phase 1: /me, Phase 2: CRUD)
├── scripts/
│   ├── createTables.js         ← Creates 6 DynamoDB tables (one-time)
│   ├── seedDefaults.js         ← Seeds plans + default roles per org
│   └── backfillSuperAdmins.js  ← Backfills existing vendors/clients as Super Admins
└── utils/
    └── permission.utils.js     ← Pure permission-checking helpers
```

## Middleware Chain
```
authenticateCognitoJwt → attachVendorId → attachRBAC → route handler
```
- `attachVendorId` (at `middleware/attachVendorId.js`):
  1. Primary: Queries `vendors.EmailIndex` GSI → sets `req.vendorId`
  2. Fallback (team members): Queries `rbac_members.UserOrgsIndex` by Cognito sub → finds active vendor membership → sets `req.vendorId = orgId`, `req.isTeamMember = true`
  3. Note: vendorId hint validation may log "does not match authenticated email" for team members — this is expected and harmless.
- `attachRBAC`: Reads `req.vendorId` (sync `resolveOrg()`) → GetItem `rbac_members` → GetItem `rbac_roles` → sets `req.rbac`

### attachRBAC Known Gotchas (all fixed, documented for future reference)
1. **Reserved keyword `permissions`**: Must alias as `#perms` in `ProjectionExpression` for `rbac_roles` GetItem. Without alias → `ValidationException` → catch block → Super Admin Error Fallback.
2. **Credential provider in db.js**: Must use default provider chain (`new DynamoDBClient({ region })`), NOT explicit `credentials: { accessKeyId, secretAccessKey }`. Explicit credentials freeze at ESM module-load time → `undefined` if module loaded before `dotenv.config()`.
3. **Permissions type safety**: `role.permissions` could be a DynamoDB Set (SS) instead of List (L). Code defensively handles both Array and Set.
4. **Phase 1 permissive mode**: If no membership found OR any error occurs, grants Super Admin fallback with `_fallback: true`. Will be tightened in Phase 4.

## Team Member Login Flow
- Team members share the org's vendorId/clientId — no separate vendor/client record.
- `inviteAcceptController.js` creates only a `users` table record (with `isTeamMember: true`, `parentOrgId`) — NOT a vendor/client record.
- `/api/auth/verify` detects team members via `rbac_members.EmailIndex` fallback, returns `isTeamMember: true`.
- `/api/vendor/me` resolves team members via `rbac_members.UserOrgsIndex`, returns org owner's vendor data with `isTeamMember: true`.
- **Lookup order in /me is critical**: vendors → team member (rbac_members) → google_users → 404. Team member check MUST run before google_users to avoid stale data.
- Frontend `routeVendor()` navigates team members directly to `/VendorDashboard`; `VendorGuard` skips onboarding checks.
- For full details, see `Documents/RBAC/Team_Member_Login_Flow.md`.

## API Routes
| Method | Path | Description | Permission |
|--------|------|-------------|------------|
| GET | `/api/rbac/me` | Current user's RBAC context | (auth only) |
| GET | `/api/rbac/members` | List org members | user_management:view |
| POST | `/api/rbac/members/invite` | Invite member by email | user_management:create |
| PATCH | `/api/rbac/members/:userId/role` | Change member's role | user_management:edit |
| DELETE | `/api/rbac/members/:userId` | Remove member (soft) | user_management:edit |
| GET | `/api/rbac/roles` | List roles + canAssign | user_management:view |
| GET | `/api/rbac/invitations` | List invitations | user_management:view |
| DELETE | `/api/rbac/invitations/:inviteId` | Cancel invitation | user_management:edit |

## Extended Enforcement Coverage (Phase 5)
RBAC now protects vendor lead operations in `modules/vendor/routes/vendorLeadRoutes.js` via:
`authenticateCognitoJwt → attachVendorId → attachRBAC → requirePermission`.

| Method | Path | Permission |
|--------|------|------------|
| POST | `/api/vendor-leads` | leads:view |
| POST | `/api/vendor-leads/stats` | leads:view |
| GET | `/api/vendor-leads/:leadId` | leads:view |
| POST | `/api/vendor-leads/:leadId/respond` | leads:edit |
| PUT | `/api/vendor-leads/:leadId/response` | leads:edit |
| POST | `/api/vendor-leads/:leadId/boq-download` | leads:view |
| POST | `/api/vendor-leads/:leadId/quotation` | leads:edit |
| PUT | `/api/vendor-leads/:leadId/quotation` | leads:edit |
| POST | `/api/vendor-leads/:leadId/vendor-boq` | leads:edit |
| POST | `/api/vendor-leads/:leadId/vendor-quotation` | leads:edit |

## req.rbac Shape
```js
{
  orgId,          // vendorId or clientId
  orgType,        // 'vendor' or 'client'
  userId,         // Cognito sub
  roleId,         // e.g. 'super_admin', 'admin', 'member'
  roleName,       // Display name
  roleLevel,      // 0=Super Admin, 1=Admin, 2=Manager, 3=Member, 4=Viewer
  permissions,    // ['*:*'] or ['products:view', 'orders:manage', ...]
  permissionSet,  // Set for O(1) lookups
  isSuperAdmin,   // boolean
  _fallback,      // true if granted via Phase 1 permissive fallback
}
```

## DynamoDB Tables
| Table | PK | SK | Key GSIs |
|-------|----|----|----------|
| rbac_organizations | orgId | — | SuperAdminIndex, OrgTypeIndex |
| rbac_roles | orgId | roleId | RoleLevelIndex (LSI) |
| rbac_members | orgId | userId | UserOrgsIndex, EmailIndex |
| rbac_invitations | inviteId | — | OrgInvitesIndex, EmailInvitesIndex, TokenIndex |
| rbac_audit_log | orgId | timestamp | UserAuditIndex |
| rbac_subscription_plans | planId | — | — |

## How to Add a New Module
1. Add entry to `config/modules.js` → `VENDOR_MODULES`
2. Add default permissions in `config/roles.js` for each role
3. Done — middleware and frontend auto-detect the new module

## Dependencies
- `@aws-sdk/client-dynamodb` (v3)
- `@aws-sdk/lib-dynamodb` (v3)

## Scripts (run from Vendor_Backend root)
```bash
node modules/rbac/scripts/createTables.js       # Create DynamoDB tables
node modules/rbac/scripts/seedDefaults.js        # Seed plans + roles
node modules/rbac/scripts/backfillSuperAdmins.js # Migrate existing accounts
```

## Timed Suspension Auto-Reactivation
- RBAC module now starts a background scheduler at module bootstrap (`initializeSuspensionScheduler`).
- Scheduler scans `rbac_members` for rows where:
  - `status = suspended`
  - `suspendedUntil` exists and is <= now
- It updates those members back to `active` and writes audit event `MEMBER_AUTO_UNSUSPENDED`.
- Tunables:
  - `RBAC_SUSPENSION_SWEEP_INTERVAL_MS` (default `60000`)
  - `RBAC_SUSPENSION_SWEEP_BATCH_SIZE` (default `100`)

## Phase Roadmap
- **Phase 1** (done): Permissive mode, backfill, GET /me
- **Phase 2** (done): Team member CRUD, invitations, role management
- **Phase 2.5A** (done): Role CRUD API + Frontend role editor
- **Phase 2.5B** (done): Frontend team management UI (TeamPage.jsx)
- **Phase 2.5B+** (done): SES email, env variables, UI enhancements
- **Phase 2.5C** (done): Email invitation + acceptance flow (InviteAcceptPage)
- **Team Member Login Flow** (done): Shared-org model, middleware fallbacks, frontend routing
- **Phase 3**: Audit logging, custom roles (planned)
- **Phase 4**: Full enforcement (remove permissive fallbacks)
