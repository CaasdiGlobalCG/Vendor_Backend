# RBAC Module — Vendor Backend Context

## Overview
Role-Based Access Control (RBAC) module for the Vendor Backend.
RBAC operates in **strict enforcement mode** — users without membership or permissions are denied.

## Modular Monolith Role (rbacdev branch)
This module is the **single RBAC authority** for all Caasdi backends:
- **Vendor backend**: uses RBAC in-process (attachRBAC + requirePermission)
- **Client backend**: calls vendor `/api/rbac/me` at login, embeds permissions in session
- **Sales backend**: calls vendor `/api/rbac/me` at login, embeds permissions in session

The `attachOrgId` middleware (new in rbacdev) resolves ANY org type (vendor OR client)
from `rbac_members.UserOrgsIndex`, so client/sales users calling vendor's RBAC API
get their correct `orgType` and module registry. The old `attachVendorId` only
resolved vendor orgs — client users got `orgType='vendor'` (wrong) and the wrong
module list.

### Why modular monolith (not shared package)
- 1 source code copy, 1 runtime authority (this module)
- No package versioning discipline needed across 3 backends
- Sales already wired via `VENDOR_BACKEND_URL`
- Vendor stays in-process (heaviest RBAC user)
- Client/sales pay 1 network call at login, then in-process per-request checks via session embedding

### Session embedding pattern (WorkOS-style)
```
Client/Sales login → call vendor /api/rbac/me once → embed permissions[] in session
Subsequent requests → read permissions from session → requirePermission check (in-process, ~0.1ms)
```
Permission *checks* stay in-process in client/sales. Permission *management* (invite,
create role, list members, audit log) calls vendor backend over HTTP — those are
low-frequency admin UI actions where the network hop is fine.

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
│   ├── resourceAssignmentController.js ← direct project/workspace member access APIs
│   ├── rolesController.js      ← listRoles with canAssign flag
│   └── invitationsController.js ← listInvitations, cancelInvitation
├── routes/
│   └── rbacRoutes.js           ← Express router (Phase 1: /me, Phase 2: CRUD + scope updates)
├── scripts/
│   ├── createTables.js         ← Creates 6 DynamoDB tables (one-time)
│   ├── seedDefaults.js         ← Seeds plans + default roles per org
│   └── backfillSuperAdmins.js  ← Backfills existing vendors/clients as Super Admins
└── utils/
  ├── permission.utils.js     ← Pure permission-checking helpers
  └── scopeAccess.utils.js    ← Project/workspace scope normalization + checks
```

## Middleware Chain
```
authenticateCognitoJwt → attachOrgId → attachRBAC → route handler
```
- `attachOrgId` (at `modules/rbac/middleware/attachOrgId.js`):
  1. Queries `rbac_members.UserOrgsIndex` by Cognito sub → finds active membership
  2. Gets `rbac_organizations` → reads `orgType` + native ID (`vendorId`/`clientId`)
  3. Sets `req.parentOrgId` (stable RBAC org UUID), `req.orgType`, `req.vendorId`/`req.clientId`
  4. Generic — works for vendor AND client users (unlike old `attachVendorId`)
- `attachRBAC`: Reads `req.parentOrgId` (via `resolveOrg()`) → GetItem `rbac_members` → GetItem `rbac_roles` → sets `req.rbac`
- **Note**: Vendor-specific routes outside RBAC (leads, projects, workspace) still use `attachVendorId` — they need the native vendor ID, not just the RBAC org UUID. RBAC routes use `attachOrgId` because RBAC is org-type agnostic.

### attachRBAC Known Gotchas (all fixed, documented for future reference)
1. **Reserved keyword `permissions`**: Must alias as `#perms` in `ProjectionExpression` for `rbac_roles` GetItem. Without alias → `ValidationException`.
2. **Credential provider in db.js**: Must use default provider chain (`new DynamoDBClient({ region })`), NOT explicit `credentials: { accessKeyId, secretAccessKey }`. Explicit credentials freeze at ESM module-load time → `undefined` if module loaded before `dotenv.config()`.
3. **Permissions type safety**: `role.permissions` could be a DynamoDB Set (SS) instead of List (L). Code defensively handles both Array and Set.
4. **Strict membership enforcement**: If no membership is found, `attachRBAC` returns 403 and does not auto-create or auto-promote users.

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
| GET | `/api/rbac/invite/validate` | Public invite token validation | Public (no auth) |
| POST | `/api/rbac/invite/accept` | Public invite acceptance | Public (no auth) |
| GET | `/api/rbac/me` | Current user's RBAC context | (auth only) |
| GET | `/api/rbac/members` | List org members | user_management:view |
| POST | `/api/rbac/members/invite` | Invite member by email | user_management:create |
| PATCH | `/api/rbac/members/:userId/role` | Change member's role | user_management:edit |
| PATCH | `/api/rbac/members/:userId/access-scopes` | Update member project/workspace scopes | user_management:edit |
| DELETE | `/api/rbac/members/:userId` | Remove member (soft) | user_management:edit |
| GET | `/api/rbac/roles` | List roles + canAssign | user_management:view |
| GET | `/api/rbac/invitations` | List invitations | user_management:view |
| DELETE | `/api/rbac/invitations/:inviteId` | Cancel invitation | user_management:edit |

### Invite Route Isolation Guardrail
- Public invite routes are declared before `router.use(authenticateCognitoJwt)` inside `modules/rbac/routes/rbacRoutes.js`.
- This makes `/api/rbac/invite/validate` and `/api/rbac/invite/accept` stay public even if environment-specific server mount order differs.
- Additional aliases now exist for both mount shapes (`/api/rbac` and `/api/rbac/invite`) so invite endpoints resolve correctly in either setup.
- `middleware/cognitoJwtMiddleware.js` now explicitly bypasses auth for invite validate/accept URLs, guaranteeing those routes never require a current authenticated user.

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
  accessScopes,   // { projectIds, workspaceIds, allowAllProjects, allowAllWorkspaces }
  _fallback,      // always false in strict enforcement mode
}
```

## Scoped Access Model (Projects and Workspaces)
- Member row (`rbac_members`) may include:
  - `projectAccess: string[]` (supports `['*']` for full project scope)
  - `workspaceAccess: string[]` (supports `['*']` for full workspace scope)
- `attachRBAC` normalizes these into `req.rbac.accessScopes`.
- Policy hardening:
  - `super_admin` is always treated as wildcard permission `*:*`.
  - `super_admin` is always treated as wildcard project/workspace scope.
  - `admin` and `super_admin` scopes are enforced as wildcard in member scope write flows.
- Access rules:
  - Super Admin always passes.
  - No scope arrays means backward-compatible access (no restriction).
  - If workspace scope is explicitly constrained, empty project scope does NOT imply all projects.
  - Non-empty scope arrays restrict visibility to listed IDs.
  - Workspace access can come from direct workspace scope or inherited project scope.

## Enforced Route Coverage (Projects/Workspaces)
- `modules/pm/routes/dynamoProjectRoutes.js` now enforces:
  - `authenticateCognitoJwt -> attachVendorId -> attachRBAC -> requirePermission('projects', ...)`
  - Direct assignment APIs:
    - `GET /api/projects/:id/member-access`
    - `PATCH /api/projects/:id/member-access`
- `modules/workspace/routes/dynamoWorkspaceRoutes.js` now enforces:
  - `authenticateCognitoJwt -> attachVendorId -> attachRBAC -> requirePermission('workspace', ...)`
  - Direct assignment APIs:
    - `GET /api/workspaces/:id/member-access`
    - `PATCH /api/workspaces/:id/member-access`
- `modules/workspace/routes/workspaceAccessRoutes.js` now enforces:
  - `authenticateCognitoJwt -> attachVendorId -> attachRBAC -> requirePermission('workspace', 'view')`

## DynamoDB Tables
| Table | PK | SK | Key GSIs |
|-------|----|----|----------|
| rbac_organizations | orgId | — | SuperAdminIndex, OrgTypeIndex |
| rbac_roles | orgId | roleId | RoleLevelIndex (LSI) |
| rbac_members | orgId | userId | UserOrgsIndex, EmailIndex |
| rbac_invitations | inviteId | — | OrgInvitesIndex, EmailInvitesIndex, TokenIndex |
| rbac_audit_log | orgId | timestamp | UserAuditIndex |
| rbac_subscription_plans | planId | — | — |

### rbac_organizations Metadata Columns
- `vendorId` — the real `vendors` table PK (e.g. `SAN-260904-000`). Present on vendor orgs. Lets team-member lookups resolve the vendor record without scanning by email.
- `clientId` — the real `clients` table PK (UUID). Present on client orgs. Mirrors `vendorId` for client team-member lookups. Backfilled via `backfillClientOrgIds.js` and stamped at account creation in the set-role flow (`dynamoAuthRoutes.js`).

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
node modules/rbac/scripts/backfillMemberScopes.js # Backfill missing project/workspace scopes
node modules/rbac/scripts/backfillClientOrgIds.js # Backfill clientId on client rbac_organizations
```

### Scope Backfill Script
- `backfillMemberScopes.js` fills missing `projectAccess` and `workspaceAccess` with `['*']` for legacy members.
- Default mode is dry-run.
- Set `BACKFILL_DRY_RUN=false` to write updates.

### Client Org ID Backfill Script
- `backfillClientOrgIds.js` stamps `clientId` on `rbac_organizations` for existing client orgs.
- Scans `users` table for records with `clientOrgId`, matches to `rbac_organizations` via `parentOrgId`.
- Default mode is dry-run.
- Set `BACKFILL_DRY_RUN=false` to write updates.

## Tests
- Existing unit tests: `modules/rbac/tests/test-rbac-units.js`
- Existing API tests: `modules/rbac/tests/test-rbac-api.js`
- New scoped-access unit tests: `modules/rbac/tests/test-rbac-scope-units.js`

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
- **Phase 1** (done): Initial rollout, backfill, GET /me
- **Phase 2** (done): Team member CRUD, invitations, role management
- **Phase 2.5A** (done): Role CRUD API + Frontend role editor
- **Phase 2.5B** (done): Frontend team management UI (TeamPage.jsx)
- **Phase 2.5B+** (done): SES email, env variables, UI enhancements
- **Phase 2.5C** (done): Email invitation + acceptance flow (InviteAcceptPage)
- **Team Member Login Flow** (done): Shared-org model, middleware fallbacks, frontend routing
- **Phase 3**: Audit logging, custom roles (planned)
- **Phase 4** (done): Full enforcement (permissive fallbacks removed)
