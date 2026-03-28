// ============================================================
// FILE: test-rbac-units.js
// PURPOSE: Automated unit tests for RBAC pure utility functions.
//          No server or DB needed — tests in-memory logic only.
// RUN:    node modules/rbac/tests/test-rbac-units.js
// ============================================================

import { hasPermission, isSuperAdmin, canManageUser, getAccessibleModules, buildPermissionMap } from '../utils/permission.utils.js';
import { VENDOR_MODULES, CLIENT_MODULES, SALES_MODULES, getAllPermissions, getModuleKeys, derivePlatformAccess } from '../config/modules.js';
import { ROLE_LEVELS, VENDOR_DEFAULT_ROLES, CLIENT_DEFAULT_ROLES } from '../config/roles.js';

// ── Simple test harness ──
let totalTests = 0;
let passed = 0;
let failed = 0;
const failures = [];

function assert(testName, condition, detail = '') {
  totalTests++;
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    const msg = `  ❌ ${testName}${detail ? ' — ' + detail : ''}`;
    console.log(msg);
    failures.push({ testName, detail });
  }
}

function section(name) {
  console.log(`\n━━━ ${name} ━━━`);
}

// ═══════════════════════════════════════════════════════════
// SECTION 1: hasPermission()
// ═══════════════════════════════════════════════════════════
section('1. hasPermission()');

// 1.1 — Wildcard *:* grants everything
assert('1.1 *:* grants any module:action',
  hasPermission(new Set(['*:*']), 'products', 'create') === true);

assert('1.2 *:* grants unknown module',
  hasPermission(new Set(['*:*']), 'nonexistent', 'delete') === true);

// 1.3 — module:manage grants all actions for that module
assert('1.3 module:manage grants create',
  hasPermission(new Set(['products:manage']), 'products', 'create') === true);

assert('1.4 module:manage grants view',
  hasPermission(new Set(['products:manage']), 'products', 'view') === true);

assert('1.5 module:manage grants delete',
  hasPermission(new Set(['products:manage']), 'products', 'delete') === true);

assert('1.6 module:manage does NOT grant other modules',
  hasPermission(new Set(['products:manage']), 'orders', 'view') === false);

// 1.7 — Exact match
assert('1.7 Exact match products:view',
  hasPermission(new Set(['products:view']), 'products', 'view') === true);

assert('1.8 Exact match does NOT grant different action',
  hasPermission(new Set(['products:view']), 'products', 'create') === false);

// 1.9 — Empty permissions
assert('1.9 Empty set denies everything',
  hasPermission(new Set(), 'products', 'view') === false);

// 1.10 — Array input (not Set)
assert('1.10 Accepts array input',
  hasPermission(['products:view', 'orders:create'], 'products', 'view') === true);

assert('1.11 Array input denies missing perm',
  hasPermission(['products:view'], 'products', 'create') === false);

// ═══════════════════════════════════════════════════════════
// SECTION 2: isSuperAdmin()
// ═══════════════════════════════════════════════════════════
section('2. isSuperAdmin()');

assert('2.1 *:* is Super Admin',
  isSuperAdmin(new Set(['*:*'])) === true);

assert('2.2 Regular perms is NOT Super Admin',
  isSuperAdmin(new Set(['products:manage', 'orders:view'])) === false);

assert('2.3 Empty set is NOT Super Admin',
  isSuperAdmin(new Set()) === false);

assert('2.4 Array with *:* is Super Admin',
  isSuperAdmin(['*:*']) === true);

assert('2.5 Array without *:* is NOT Super Admin',
  isSuperAdmin(['products:manage']) === false);

// ═══════════════════════════════════════════════════════════
// SECTION 3: canManageUser()
// ═══════════════════════════════════════════════════════════
section('3. canManageUser()');

assert('3.1 Level 0 can manage level 1',
  canManageUser(0, 1) === true);

assert('3.2 Level 0 can manage level 4',
  canManageUser(0, 4) === true);

assert('3.3 Level 1 can manage level 2',
  canManageUser(1, 2) === true);

assert('3.4 Level 1 can manage level 3',
  canManageUser(1, 3) === true);

assert('3.5 Same level CANNOT manage peer',
  canManageUser(2, 2) === false);

assert('3.6 Higher level CANNOT manage lower level',
  canManageUser(3, 1) === false);

assert('3.7 Level 4 CANNOT manage level 0',
  canManageUser(4, 0) === false);

assert('3.8 Nobody can manage level 0 (Super Admin)',
  canManageUser(1, 0) === false);

// ═══════════════════════════════════════════════════════════
// SECTION 4: getAccessibleModules()
// ═══════════════════════════════════════════════════════════
section('4. getAccessibleModules()');

assert('4.1 *:* returns ["*"]',
  JSON.stringify(getAccessibleModules(['*:*'])) === '["*"]');

assert('4.2 Single module returns that module',
  JSON.stringify(getAccessibleModules(['products:view'])) === '["products"]');

const modules43 = getAccessibleModules(['products:view', 'products:create', 'orders:view']);
assert('4.3 Multiple perms returns unique modules',
  modules43.length === 2 && modules43.includes('products') && modules43.includes('orders'));

assert('4.4 Empty array returns empty',
  getAccessibleModules([]).length === 0);

const modules45 = getAccessibleModules(['products:view', 'orders:create', 'settings:edit']);
assert('4.5 Three different modules returns 3',
  modules45.length === 3);

// ═══════════════════════════════════════════════════════════
// SECTION 5: buildPermissionMap()
// ═══════════════════════════════════════════════════════════
section('5. buildPermissionMap()');

const map51 = buildPermissionMap(['products:view', 'products:create', 'orders:view']);
assert('5.1 Groups by module',
  JSON.stringify(map51) === '{"products":["view","create"],"orders":["view"]}');

const map52 = buildPermissionMap(['*:*', 'products:view']);
assert('5.2 Skips *:* wildcard',
  map52['*'] === undefined && map52['products'] !== undefined);

const map53 = buildPermissionMap([]);
assert('5.3 Empty array returns empty map',
  Object.keys(map53).length === 0);

const map54 = buildPermissionMap(['dashboard:view', 'dashboard:export', 'dashboard:manage']);
assert('5.4 Multiple actions on same module',
  map54['dashboard'].length === 3);

// ═══════════════════════════════════════════════════════════
// SECTION 6: Module Registries
// ═══════════════════════════════════════════════════════════
section('6. Module Registries');

assert('6.1 VENDOR_MODULES has 17 modules',
  Object.keys(VENDOR_MODULES).length === 17,
  `Got ${Object.keys(VENDOR_MODULES).length}`);

assert('6.2 CLIENT_MODULES has 14 modules',
  Object.keys(CLIENT_MODULES).length === 14,
  `Got ${Object.keys(CLIENT_MODULES).length}`);

assert('6.3 SALES_MODULES has 12 modules',
  Object.keys(SALES_MODULES).length === 12,
  `Got ${Object.keys(SALES_MODULES).length}`);

// Verify every module has label and actions
let allModulesValid = true;
for (const [key, mod] of Object.entries(VENDOR_MODULES)) {
  if (!mod.label || !Array.isArray(mod.actions) || mod.actions.length === 0) {
    allModulesValid = false;
    break;
  }
}
assert('6.4 All VENDOR_MODULES have label + actions', allModulesValid);

allModulesValid = true;
for (const [key, mod] of Object.entries(CLIENT_MODULES)) {
  if (!mod.label || !Array.isArray(mod.actions) || mod.actions.length === 0) {
    allModulesValid = false;
    break;
  }
}
assert('6.5 All CLIENT_MODULES have label + actions', allModulesValid);

allModulesValid = true;
for (const [key, mod] of Object.entries(SALES_MODULES)) {
  if (!mod.label || !Array.isArray(mod.actions) || mod.actions.length === 0) {
    allModulesValid = false;
    break;
  }
}
assert('6.6 All SALES_MODULES have label + actions', allModulesValid);

// Every module must have 'manage' as an action
let allHaveManage = true;
for (const [key, mod] of Object.entries(VENDOR_MODULES)) {
  if (!mod.actions.includes('manage')) {
    allHaveManage = false;
    break;
  }
}
assert('6.7 All VENDOR_MODULES include manage action', allHaveManage);

allHaveManage = true;
for (const [key, mod] of Object.entries(CLIENT_MODULES)) {
  if (!mod.actions.includes('manage')) {
    allHaveManage = false;
    break;
  }
}
assert('6.8 All CLIENT_MODULES include manage action', allHaveManage);

allHaveManage = true;
for (const [key, mod] of Object.entries(SALES_MODULES)) {
  if (!mod.actions.includes('manage')) {
    allHaveManage = false;
    break;
  }
}
assert('6.9 All SALES_MODULES include manage action', allHaveManage);

// ── getAllPermissions ──
const vendorPerms = getAllPermissions(VENDOR_MODULES);
assert('6.10 getAllPermissions returns Set', vendorPerms instanceof Set);
assert('6.11 Vendor perms include products:create', vendorPerms.has('products:create'));
assert('6.12 Vendor perms include dashboard:view', vendorPerms.has('dashboard:view'));
assert('6.13 Vendor perms do NOT include nonexistent:view', !vendorPerms.has('nonexistent:view'));

// ── getModuleKeys ──
const vendorKeys = getModuleKeys(VENDOR_MODULES);
assert('6.14 getModuleKeys returns array', Array.isArray(vendorKeys));
assert('6.15 Vendor keys include products', vendorKeys.includes('products'));
assert('6.16 Vendor keys include dashboard', vendorKeys.includes('dashboard'));

// ═══════════════════════════════════════════════════════════
// SECTION 7: derivePlatformAccess() — orgType-aware
// ═══════════════════════════════════════════════════════════
section('7. derivePlatformAccess()');

// ── 7A: Super Admin — always all 3 regardless of orgType ──

const sa = derivePlatformAccess(['*:*']);
assert('7.1 *:* (no orgType) → all 3 platforms',
  sa.length === 3 && sa.includes('vendor') && sa.includes('client') && sa.includes('sales'));

const saVendor = derivePlatformAccess(['*:*'], 'vendor');
assert('7.2 *:* (vendor org) → all 3 platforms',
  saVendor.length === 3 && saVendor.includes('vendor') && saVendor.includes('client') && saVendor.includes('sales'));

const saClient = derivePlatformAccess(['*:*'], 'client');
assert('7.3 *:* (client org) → all 3 platforms',
  saClient.length === 3 && saClient.includes('vendor') && saClient.includes('client') && saClient.includes('sales'));

// ── 7B: Empty / null / undefined ──

const emptyVendor = derivePlatformAccess([], 'vendor');
assert('7.4 Empty perms (vendor org) → ["vendor"]',
  emptyVendor.length === 1 && emptyVendor[0] === 'vendor');

const emptyClient = derivePlatformAccess([], 'client');
assert('7.5 Empty perms (client org) → ["client"]',
  emptyClient.length === 1 && emptyClient[0] === 'client');

const nullPerms = derivePlatformAccess(null, 'vendor');
assert('7.6 null (vendor) → ["vendor"]',
  nullPerms.length === 1 && nullPerms[0] === 'vendor');

const nullClient = derivePlatformAccess(null, 'client');
assert('7.7 null (client) → ["client"]',
  nullClient.length === 1 && nullClient[0] === 'client');

const undefPerms = derivePlatformAccess(undefined);
assert('7.8 undefined (no orgType) → ["vendor"]',
  undefPerms.length === 1 && undefPerms[0] === 'vendor');

// ── 7C: Vendor org — should NEVER include 'client' ──

const vendorDash = derivePlatformAccess(['dashboard:manage'], 'vendor');
assert('7.9 dashboard:manage (vendor org) → vendor + sales, NOT client',
  vendorDash.includes('vendor') && vendorDash.includes('sales') && !vendorDash.includes('client'),
  `Got: [${vendorDash}]`);

const vendorLeads = derivePlatformAccess(['leads:view'], 'vendor');
assert('7.10 leads:view (vendor org) → vendor only (leads not in SALES_MODULES)',
  vendorLeads.includes('vendor') && !vendorLeads.includes('client') && !vendorLeads.includes('sales'),
  `Got: [${vendorLeads}]`);

const vendorProducts = derivePlatformAccess(['products:view'], 'vendor');
assert('7.11 products:view (vendor org) → vendor + sales',
  vendorProducts.includes('vendor') && vendorProducts.includes('sales') && !vendorProducts.includes('client'),
  `Got: [${vendorProducts}]`);

const vendorOrders = derivePlatformAccess(['orders:manage'], 'vendor');
assert('7.12 orders:manage (vendor org) → vendor + sales, NOT client',
  vendorOrders.includes('vendor') && vendorOrders.includes('sales') && !vendorOrders.includes('client'),
  `Got: [${vendorOrders}]`);

const vendorCrm = derivePlatformAccess(['crm:view'], 'vendor');
assert('7.13 crm:view (vendor org) → vendor only (crm not in SALES)',
  vendorCrm.includes('vendor') && !vendorCrm.includes('client') && !vendorCrm.includes('sales'),
  `Got: [${vendorCrm}]`);

// This is the critical bug fix test:
// Admin with dashboard:manage, products:manage, etc. should NOT get client access
const adminPerms = ['dashboard:manage', 'products:manage', 'orders:manage',
  'quotations:manage', 'user_management:view', 'settings:view'];
const vendorAdmin = derivePlatformAccess(adminPerms, 'vendor');
assert('7.14 Vendor Admin role perms → vendor + sales, NEVER client',
  vendorAdmin.includes('vendor') && vendorAdmin.includes('sales') && !vendorAdmin.includes('client'),
  `Got: [${vendorAdmin}]`);

// ── 7D: Client org — should NEVER include 'vendor' or 'sales' ──

const clientDash = derivePlatformAccess(['dashboard:view'], 'client');
assert('7.15 dashboard:view (client org) → client ONLY',
  clientDash.length === 1 && clientDash[0] === 'client',
  `Got: [${clientDash}]`);

const clientExplore = derivePlatformAccess(['explore:view'], 'client');
assert('7.16 explore:view (client org) → client ONLY',
  clientExplore.length === 1 && clientExplore[0] === 'client',
  `Got: [${clientExplore}]`);

const clientOrders = derivePlatformAccess(['orders:manage', 'billing:view'], 'client');
assert('7.17 orders+billing (client org) → client ONLY, NOT vendor/sales',
  clientOrders.length === 1 && clientOrders[0] === 'client',
  `Got: [${clientOrders}]`);

// ── 7E: No orgType — backward compat (old behavior) ──

const noOrgLeads = derivePlatformAccess(['leads:view']);
assert('7.18 leads:view (no orgType) → vendor (backward compat)',
  noOrgLeads.includes('vendor'));

const noOrgExplore = derivePlatformAccess(['explore:view']);
assert('7.19 explore:view (no orgType) → client (backward compat)',
  noOrgExplore.includes('client'));

const noOrgShared = derivePlatformAccess(['dashboard:view']);
assert('7.20 dashboard:view (no orgType) → all 3 (backward compat)',
  noOrgShared.includes('vendor') && noOrgShared.includes('client') && noOrgShared.includes('sales'),
  `Got: [${noOrgShared}]`);

const noOrgBilling = derivePlatformAccess(['billing:view']);
assert('7.21 billing:view (no orgType) → client only',
  noOrgBilling.includes('client') && !noOrgBilling.includes('vendor'),
  `Got: [${noOrgBilling}]`);

// ═══════════════════════════════════════════════════════════
// SECTION 8: Default Role Definitions
// ═══════════════════════════════════════════════════════════
section('8. Default Role Definitions');

assert('8.1 VENDOR_DEFAULT_ROLES is array',
  Array.isArray(VENDOR_DEFAULT_ROLES));

assert('8.2 VENDOR_DEFAULT_ROLES has 6 roles',
  VENDOR_DEFAULT_ROLES.length === 6,
  `Got ${VENDOR_DEFAULT_ROLES.length}`);

assert('8.3 CLIENT_DEFAULT_ROLES is array',
  Array.isArray(CLIENT_DEFAULT_ROLES));

assert('8.4 CLIENT_DEFAULT_ROLES has 5 roles',
  CLIENT_DEFAULT_ROLES.length === 5,
  `Got ${CLIENT_DEFAULT_ROLES.length}`);

// Super Admin is always level 0
const vendorSA = VENDOR_DEFAULT_ROLES.find(r => r.roleId === 'super_admin');
assert('8.5 Vendor Super Admin exists',
  vendorSA !== undefined);

assert('8.6 Super Admin level is 0',
  vendorSA?.roleLevel === 0);

assert('8.7 Super Admin has *:* permission',
  vendorSA?.permissions.includes('*:*'));

assert('8.8 Super Admin is system role',
  vendorSA?.isSystem === true);

// Check level hierarchy
const vendorLevels = VENDOR_DEFAULT_ROLES.map(r => r.roleLevel).sort();
assert('8.9 Role levels include 0 (Super Admin)',
  vendorLevels.includes(0));

// Every role has required fields
const requiredFields = ['roleId', 'roleName', 'roleLevel', 'isSystem', 'permissions'];
let allFieldsPresent = true;
for (const role of VENDOR_DEFAULT_ROLES) {
  for (const field of requiredFields) {
    if (role[field] === undefined) {
      allFieldsPresent = false;
      break;
    }
  }
}
assert('8.10 All vendor roles have required fields', allFieldsPresent);

allFieldsPresent = true;
for (const role of CLIENT_DEFAULT_ROLES) {
  for (const field of requiredFields) {
    if (role[field] === undefined) {
      allFieldsPresent = false;
      break;
    }
  }
}
assert('8.11 All client roles have required fields', allFieldsPresent);

// ROLE_LEVELS constants
assert('8.12 ROLE_LEVELS.SUPER_ADMIN = 0', ROLE_LEVELS.SUPER_ADMIN === 0);
assert('8.13 ROLE_LEVELS.ADMIN = 1', ROLE_LEVELS.ADMIN === 1);
assert('8.14 ROLE_LEVELS.MANAGER = 2', ROLE_LEVELS.MANAGER === 2);
assert('8.15 ROLE_LEVELS.MEMBER = 3', ROLE_LEVELS.MEMBER === 3);
assert('8.16 ROLE_LEVELS.VIEWER = 4', ROLE_LEVELS.VIEWER === 4);

// ═══════════════════════════════════════════════════════════
// SECTION 9: requirePermission middleware (mock test)
// ═══════════════════════════════════════════════════════════
section('9. requirePermission middleware');

import { requirePermission, requireSuperAdmin } from '../middleware/requirePermission.js';

// Helper to create mock req/res/next
function mockMiddleware() {
  let statusCode = null;
  let jsonBody = null;
  let nextCalled = false;
  const res = {
    status(code) { statusCode = code; return res; },
    json(body) { jsonBody = body; return res; },
  };
  const next = () => { nextCalled = true; };
  return { res, next, getStatus: () => statusCode, getBody: () => jsonBody, wasNextCalled: () => nextCalled };
}

// 9.1 — No rbac context → 403
{
  const mw = requirePermission('products', 'view');
  const { res, next, getStatus, wasNextCalled } = mockMiddleware();
  mw({ rbac: null }, res, next);
  assert('9.1 No req.rbac → 403', getStatus() === 403 && !wasNextCalled());
}

// 9.2 — No rbac at all → 403
{
  const mw = requirePermission('products', 'view');
  const { res, next, getStatus, wasNextCalled } = mockMiddleware();
  mw({}, res, next);
  assert('9.2 No rbac property → 403', getStatus() === 403 && !wasNextCalled());
}

// 9.3 — _fallback flag does not bypass permission checks
{
  const mw = requirePermission('products', 'view');
  const { res, next, getStatus, wasNextCalled } = mockMiddleware();
  mw({ rbac: { _fallback: true, isSuperAdmin: true, permissionSet: new Set() } }, res, next);
  assert('9.3 _fallback without permission → 403', getStatus() === 403 && !wasNextCalled());
}

// 9.4 — *:* Super Admin → allowed
{
  const mw = requirePermission('products', 'create');
  const { res, next, wasNextCalled } = mockMiddleware();
  mw({ rbac: { permissionSet: new Set(['*:*']) } }, res, next);
  assert('9.4 *:* permission → next()', wasNextCalled());
}

// 9.5 — module:manage → allowed for any action on that module
{
  const mw = requirePermission('products', 'delete');
  const { res, next, wasNextCalled } = mockMiddleware();
  mw({ rbac: { permissionSet: new Set(['products:manage']) } }, res, next);
  assert('9.5 products:manage → allows products:delete', wasNextCalled());
}

// 9.6 — Exact match → allowed
{
  const mw = requirePermission('orders', 'view');
  const { res, next, wasNextCalled } = mockMiddleware();
  mw({ rbac: { permissionSet: new Set(['orders:view']) } }, res, next);
  assert('9.6 Exact match orders:view → next()', wasNextCalled());
}

// 9.7 — Wrong action → denied
{
  const mw = requirePermission('orders', 'delete');
  const { res, next, getStatus, wasNextCalled, getBody } = mockMiddleware();
  mw({ rbac: { permissionSet: new Set(['orders:view']), userId: 'u1', roleName: 'member', orgId: 'org1' } }, res, next);
  assert('9.7 orders:view does NOT grant orders:delete',
    getStatus() === 403 && !wasNextCalled() && getBody().required === 'orders:delete');
}

// 9.8 — Wrong module → denied
{
  const mw = requirePermission('settings', 'view');
  const { res, next, getStatus, wasNextCalled } = mockMiddleware();
  mw({ rbac: { permissionSet: new Set(['products:view']), userId: 'u1', roleName: 'member', orgId: 'org1' } }, res, next);
  assert('9.8 products:view does NOT grant settings:view', getStatus() === 403 && !wasNextCalled());
}

// 9.9 — requireSuperAdmin with Super Admin
{
  const mw = requireSuperAdmin();
  const { res, next, wasNextCalled } = mockMiddleware();
  mw({ rbac: { isSuperAdmin: true, permissionSet: new Set(['*:*']) } }, res, next);
  assert('9.9 requireSuperAdmin — Super Admin → next()', wasNextCalled());
}

// 9.10 — requireSuperAdmin with non-admin
{
  const mw = requireSuperAdmin();
  const { res, next, getStatus, wasNextCalled } = mockMiddleware();
  mw({ rbac: { isSuperAdmin: false, permissionSet: new Set(['products:manage']) } }, res, next);
  assert('9.10 requireSuperAdmin — non-admin → 403', getStatus() === 403 && !wasNextCalled());
}

// 9.11 — requireSuperAdmin relies on isSuperAdmin only
{
  const mw = requireSuperAdmin();
  const { res, next, wasNextCalled } = mockMiddleware();
  mw({ rbac: { _fallback: true, isSuperAdmin: true } }, res, next);
  assert('9.11 requireSuperAdmin — isSuperAdmin true → next()', wasNextCalled());
}

// 9.12 — requireSuperAdmin with no rbac
{
  const mw = requireSuperAdmin();
  const { res, next, getStatus, wasNextCalled } = mockMiddleware();
  mw({}, res, next);
  assert('9.12 requireSuperAdmin — no rbac → 403', getStatus() === 403 && !wasNextCalled());
}

// ═══════════════════════════════════════════════════════════
// SECTION 10: Cross-Validation
// ═══════════════════════════════════════════════════════════
section('10. Cross-Validation');

// 10.1 — Every default role permission is valid against module registry
const allVendorPerms = getAllPermissions(VENDOR_MODULES);
for (const role of VENDOR_DEFAULT_ROLES) {
  let allValid = true;
  for (const perm of role.permissions) {
    if (perm === '*:*') continue; // Wildcard is always valid
    if (!allVendorPerms.has(perm)) {
      allValid = false;
      console.log(`    ⚠️  Role "${role.roleId}" has invalid perm: ${perm}`);
    }
  }
  assert(`10.1.${role.roleId} — all perms valid against VENDOR_MODULES`, allValid);
}

const allClientPerms = getAllPermissions(CLIENT_MODULES);
for (const role of CLIENT_DEFAULT_ROLES) {
  let allValid = true;
  for (const perm of role.permissions) {
    if (perm === '*:*') continue;
    if (!allClientPerms.has(perm)) {
      allValid = false;
      console.log(`    ⚠️  Role "${role.roleId}" has invalid perm: ${perm}`);
    }
  }
  assert(`10.2.${role.roleId} — all perms valid against CLIENT_MODULES`, allValid);
}

// 10.2 — Shared modules between registries have consistent action sets
const sharedVendorSales = Object.keys(VENDOR_MODULES).filter(k => k in SALES_MODULES);
for (const key of sharedVendorSales) {
  const vActions = new Set(VENDOR_MODULES[key].actions);
  const sActions = new Set(SALES_MODULES[key].actions);
  // Sales should be a subset of (or equal to) vendor
  let salesSubset = true;
  for (const a of sActions) {
    if (!vActions.has(a)) { salesSubset = false; break; }
  }
  assert(`10.3 ${key}: sales actions ⊆ vendor actions`, salesSubset);
}

// ═══════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`RESULTS: ${passed}/${totalTests} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  ❌ ${f.testName}${f.detail ? ' — ' + f.detail : ''}`));
}
console.log('═'.repeat(60));

// Export for scripted result capture
const results = { total: totalTests, passed, failed, failures };
export default results;
