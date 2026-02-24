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
- `attachVendorId` (at `middleware/attachVendorId.js`): Queries `vendors.EmailIndex` GSI → sets `req.vendorId`
- `attachRBAC`: Reads `req.vendorId` (sync `resolveOrg()`) → GetItem `rbac_members` → GetItem `rbac_roles` → sets `req.rbac`

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

## Phase Roadmap
- **Phase 1** (done): Permissive mode, backfill, GET /me
- **Phase 2** (done): Team member CRUD, invitations, role management
- **Phase 3**: Audit logging, custom roles
- **Phase 4**: Full enforcement (remove permissive fallbacks)
