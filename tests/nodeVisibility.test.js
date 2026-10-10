/**
 * Workspace node audience — redaction and preservation suite.
 *
 * Two guarantees under test:
 *  1. A viewer never receives nodes restricted to other roles (privacy is
 *     enforced in the payload, not just hidden in the UI).
 *  2. A restricted viewer saving the canvas cannot delete the nodes they
 *     cannot see.
 *
 * Fails open everywhere: missing/unknown audience and unknown roles keep
 * content visible, so this feature can never silently lose work.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKSPACE_ROLES,
  canRoleSeeNode,
  getNodeAudience,
  normalizeRole,
  preserveHiddenNodes,
  preserveHiddenSubtaskNodes,
  redactNodesForRole,
  redactWorkspaceForRole,
} from '../modules/workspace/utils/nodeVisibility.js';

const textNode = (id, visibleTo) => ({
  id,
  type: 'textNode',
  data: { content: id, type: 'text', ...(visibleTo ? { visibleTo } : {}) },
});

/* ── normalizeRole ── */
test('normalizeRole maps admin-style roles onto the audience vocabulary', () => {
  assert.equal(normalizeRole('PM'), 'pm');
  assert.equal(normalizeRole('vendor'), 'vendor');
  assert.equal(normalizeRole('admin'), 'pm');
  assert.equal(normalizeRole('superadmin'), 'pm');
  assert.equal(normalizeRole('manager'), 'pm');
  assert.equal(normalizeRole('contractor'), null);
  assert.equal(normalizeRole(undefined), null);
});

/* ── getNodeAudience ── */
test('nodes without visibleTo are visible to everyone', () => {
  assert.deepEqual(getNodeAudience({}), [...WORKSPACE_ROLES]);
  assert.deepEqual(getNodeAudience({ visibleTo: [] }), [...WORKSPACE_ROLES]);
  assert.deepEqual(getNodeAudience({ visibleTo: 'pm' }), [...WORKSPACE_ROLES]);
});

test('an audience of only unknown roles falls back to everyone rather than hiding content', () => {
  assert.deepEqual(getNodeAudience({ visibleTo: ['contractor'] }), [...WORKSPACE_ROLES]);
});

test('audience order is normalised regardless of the stored order', () => {
  assert.deepEqual(getNodeAudience({ visibleTo: ['client', 'pm'] }), ['pm', 'client']);
});

/* ── canRoleSeeNode ── */
test('canRoleSeeNode honours explicit audiences', () => {
  const pmOnly = { visibleTo: ['pm'] };
  assert.equal(canRoleSeeNode(pmOnly, 'pm'), true);
  assert.equal(canRoleSeeNode(pmOnly, 'vendor'), false);
  assert.equal(canRoleSeeNode(pmOnly, 'client'), false);
  assert.equal(canRoleSeeNode(pmOnly, 'admin'), true, 'admin normalises to pm');
});

test('unknown viewer roles fail open so content is never lost', () => {
  const pmOnly = { visibleTo: ['pm'] };
  assert.equal(canRoleSeeNode(pmOnly, undefined), true);
  assert.equal(canRoleSeeNode(pmOnly, 'contractor'), true);
});

/* ── redactNodesForRole ── */
test('redactNodesForRole removes only the nodes the role may not see', () => {
  const nodes = [textNode('a'), textNode('b', ['pm']), textNode('c', ['pm', 'client'])];

  assert.deepEqual(redactNodesForRole(nodes, 'pm').map((n) => n.id), ['a', 'b', 'c']);
  assert.deepEqual(redactNodesForRole(nodes, 'vendor').map((n) => n.id), ['a']);
  assert.deepEqual(redactNodesForRole(nodes, 'client').map((n) => n.id), ['a', 'c']);
});

test('redactNodesForRole is a no-op for unknown roles and non-array input', () => {
  const nodes = [textNode('a'), textNode('b', ['pm'])];
  assert.equal(redactNodesForRole(nodes, 'contractor').length, 2);
  assert.equal(redactNodesForRole(undefined, 'pm'), undefined);
});

/* ── redactWorkspaceForRole ── */
test('redactWorkspaceForRole filters the top-level canvas and every subtask canvas', () => {
  const workspace = {
    workspaceId: 'WS-1',
    nodes: [textNode('top-visible'), textNode('top-pm', ['pm'])],
    tasks: [
      {
        id: 'T1',
        subtasks: [
          {
            id: 'S1',
            canvasData: { nodes: [textNode('sub-visible'), textNode('sub-pm', ['pm'])], edges: [] },
          },
        ],
      },
    ],
  };

  const forVendor = redactWorkspaceForRole(workspace, 'vendor');

  assert.deepEqual(forVendor.nodes.map((n) => n.id), ['top-visible']);
  assert.deepEqual(forVendor.tasks[0].subtasks[0].canvasData.nodes.map((n) => n.id), ['sub-visible']);
  // Edges and unrelated fields survive
  assert.deepEqual(forVendor.tasks[0].subtasks[0].canvasData.edges, []);
  // The original record is untouched
  assert.equal(workspace.nodes.length, 2);
  assert.equal(workspace.tasks[0].subtasks[0].canvasData.nodes.length, 2);
});

test('redactWorkspaceForRole leaves the record alone for unknown roles', () => {
  const workspace = { nodes: [textNode('a'), textNode('b', ['pm'])] };
  assert.equal(redactWorkspaceForRole(workspace, undefined), workspace);
  assert.equal(redactWorkspaceForRole(null, 'pm'), null);
});

/* ── preserveHiddenNodes ── */
test('preserveHiddenNodes keeps nodes the writer could not see', () => {
  const existing = [textNode('a'), textNode('pm-note', ['pm'])];
  const incomingFromVendor = [textNode('a')];

  const merged = preserveHiddenNodes(existing, incomingFromVendor, 'vendor');

  assert.deepEqual(merged.map((n) => n.id), ['a', 'pm-note']);
});

test('preserveHiddenNodes does not resurrect nodes the writer deleted on purpose', () => {
  const existing = [textNode('a'), textNode('b')];
  const incoming = [textNode('a')]; // b was deleted by a viewer who could see it

  assert.deepEqual(preserveHiddenNodes(existing, incoming, 'vendor').map((n) => n.id), ['a']);
});

test('preserveHiddenNodes lets a PM remove a restricted node', () => {
  const existing = [textNode('a'), textNode('pm-note', ['pm'])];
  const incoming = [textNode('a')];

  assert.deepEqual(preserveHiddenNodes(existing, incoming, 'pm').map((n) => n.id), ['a']);
});

test('preserveHiddenNodes is a no-op for unknown roles and missing input', () => {
  const existing = [textNode('a'), textNode('pm-note', ['pm'])];
  const incoming = [textNode('a')];

  assert.deepEqual(preserveHiddenNodes(existing, incoming, undefined).map((n) => n.id), ['a']);
  assert.deepEqual(preserveHiddenNodes(undefined, incoming, 'vendor').map((n) => n.id), ['a']);
  // An empty save from a restricted role still keeps what they could not see.
  assert.deepEqual(preserveHiddenNodes(existing, undefined, 'vendor').map((n) => n.id), ['pm-note']);
});

test('preserveHiddenSubtaskNodes merges into the subtask canvas envelope', () => {
  const existingSubtask = {
    id: 'S1',
    canvasData: { nodes: [textNode('a'), textNode('pm-note', ['pm'])], edges: [{ id: 'e1' }] },
  };
  const incomingCanvas = { nodes: [textNode('a')], edges: [{ id: 'e1' }] };

  const merged = preserveHiddenSubtaskNodes(existingSubtask, incomingCanvas, 'vendor');

  assert.deepEqual(merged.nodes.map((n) => n.id), ['a', 'pm-note']);
  assert.deepEqual(merged.edges, [{ id: 'e1' }]);
});

test('preserveHiddenSubtaskNodes tolerates a missing envelope', () => {
  const merged = preserveHiddenSubtaskNodes(undefined, { nodes: [textNode('a')] }, 'vendor');
  assert.deepEqual(merged.nodes.map((n) => n.id), ['a']);
});
