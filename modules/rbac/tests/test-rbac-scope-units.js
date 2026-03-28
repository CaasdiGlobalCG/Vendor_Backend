// ============================================================
// FILE: test-rbac-scope-units.js
// PURPOSE: Unit tests for project/workspace scoped access helpers.
// RUN:    node modules/rbac/tests/test-rbac-scope-units.js
// ============================================================

import {
  normalizeScopeAccess,
  canAccessProject,
  canAccessWorkspace,
  sanitizeScopeIds,
} from '../utils/scopeAccess.utils.js';

let total = 0;
let passed = 0;
let failed = 0;

function assert(name, condition) {
  total += 1;
  if (condition) {
    passed += 1;
    console.log(`  OK ${name}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL ${name}`);
}

function section(name) {
  console.log(`\n== ${name} ==`);
}

section('normalizeScopeAccess');
{
  const normalized = normalizeScopeAccess(['a', 'a', ''], ['w1', '*', 'w2']);
  assert('deduplicates project ids', normalized.projectIds.length === 1 && normalized.projectIds[0] === 'a');
  assert('wildcard workspace collapses ids', normalized.workspaceIds.length === 1 && normalized.workspaceIds[0] === '*');
  assert('wildcard workspace flag', normalized.allowAllWorkspaces === true);
}

section('canAccessProject');
{
  const admin = { isSuperAdmin: true, accessScopes: { projectIds: [], workspaceIds: [], allowAllProjects: false, allowAllWorkspaces: false } };
  assert('super admin always true', canAccessProject(admin, 'p1') === true);

  const unrestricted = { isSuperAdmin: false, accessScopes: { projectIds: [], workspaceIds: [], allowAllProjects: false, allowAllWorkspaces: false } };
  assert('empty project list remains backward compatible', canAccessProject(unrestricted, 'p1') === true);

  const scoped = { isSuperAdmin: false, accessScopes: { projectIds: ['p2'], workspaceIds: [], allowAllProjects: false, allowAllWorkspaces: false } };
  assert('scoped project allows listed', canAccessProject(scoped, 'p2') === true);
  assert('scoped project denies non-listed', canAccessProject(scoped, 'p9') === false);
}

section('canAccessWorkspace');
{
  const scopedWorkspace = { isSuperAdmin: false, accessScopes: { projectIds: ['p2'], workspaceIds: ['w1'], allowAllProjects: false, allowAllWorkspaces: false } };
  assert('workspace allow from direct list', canAccessWorkspace(scopedWorkspace, 'w1', 'p9') === true);
  assert('workspace allow inherited from project', canAccessWorkspace(scopedWorkspace, 'w9', 'p2') === true);
  assert('workspace deny when neither scope matches', canAccessWorkspace(scopedWorkspace, 'w9', 'p9') === false);
}

section('sanitizeScopeIds');
{
  const cleaned = sanitizeScopeIds([' p1 ', 'p1', '', 'p2']);
  assert('sanitize and dedupe', cleaned.length === 2 && cleaned.includes('p1') && cleaned.includes('p2'));

  const wildcard = sanitizeScopeIds(['p1', '*', 'p2']);
  assert('wildcard dominance', wildcard.length === 1 && wildcard[0] === '*');
}

console.log(`\nSummary: ${passed}/${total} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
