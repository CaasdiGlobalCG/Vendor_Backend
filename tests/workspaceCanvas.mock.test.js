/**
 * Workspace canvas data layer — mocked-AWS suite (T4: mocked live services).
 *
 * Patches the singleton v2 DynamoDB client's methods (the same technique the
 * support controller tests use) so controllers/models can be exercised with
 * zero real AWS calls. Focus: the canvas persistence path that every calculator
 * element depends on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { dynamoDB, s3, WORKSPACES_TABLE } from '../config/aws.js';
import * as DynamoWorkspace from '../modules/workspace/models/DynamoWorkspace.js';
import * as workspaceController from '../modules/workspace/controllers/dynamoWorkspaceController.js';
import * as workspaceControllerMain from '../modules/workspace/controllers/workspaceController.js';

const mockPromise = (result) => ({ promise: () => Promise.resolve(result) });

const patchClient = async (patches, fn) => {
  const originals = {};
  for (const [method, impl] of Object.entries(patches)) {
    originals[method] = dynamoDB[method];
    dynamoDB[method] = impl;
  }
  try {
    return await fn();
  } finally {
    for (const [method, original] of Object.entries(originals)) {
      dynamoDB[method] = original;
    }
  }
};

const patchS3 = async (impl, fn) => {
  const original = s3.upload;
  s3.upload = impl;
  try {
    return await fn();
  } finally {
    s3.upload = original;
  }
};

const createRes = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

/* ── Model: createWorkspace ── */
test('createWorkspace writes the full canvas envelope with sane defaults', async () => {
  let captured = null;
  await patchClient(
    { put: (params) => { captured = params; return mockPromise({}); } },
    async () => {
      const ws = await DynamoWorkspace.createWorkspace({ projectId: 'PROJ-1', vendorId: 'SAN-1', title: 'Test WS' });
      assert.ok(ws.workspaceId, 'workspaceId should be generated');
      assert.equal(ws.id, ws.workspaceId, 'legacy id alias should match');
      assert.equal(ws.projectId, 'PROJ-1');
      assert.deepEqual(ws.nodes, []);
      assert.deepEqual(ws.edges, []);
      assert.equal(ws.zoomLevel, 100);
      assert.equal(ws.status, 'active');
      assert.equal(ws.isShared, false);
    }
  );
  assert.equal(captured.TableName, WORKSPACES_TABLE);
  assert.equal(captured.Item.vendorId, 'SAN-1');
});

/* ── Controller: createWorkspace ── */
test('POST createWorkspace → 201 with the created workspace', async () => {
  await patchClient(
    { put: () => mockPromise({}) },
    async () => {
      const res = createRes();
      await workspaceController.createWorkspace({ body: { projectId: 'PROJ-2', vendorId: 'SAN-2' } }, res);
      assert.equal(res.statusCode, 201);
      assert.ok(res.body.workspaceId);
      assert.equal(res.body.projectId, 'PROJ-2');
    }
  );
});

test('POST createWorkspace → 500 when DynamoDB fails', async () => {
  await patchClient(
    { put: () => ({ promise: () => Promise.reject(new Error('boom')) }) },
    async () => {
      const res = createRes();
      await workspaceController.createWorkspace({ body: {} }, res);
      assert.equal(res.statusCode, 500);
      assert.match(res.body.message, /Failed to create workspace/);
    }
  );
});

/* ── Model: getWorkspaceById (primary key + scan fallback) ── */
test('getWorkspaceById returns the item from the primary-key get', async () => {
  await patchClient(
    { get: () => mockPromise({ Item: { workspaceId: 'ws-1', nodes: [{ id: 'n1' }] } }) },
    async () => {
      const ws = await DynamoWorkspace.getWorkspaceById('ws-1');
      assert.equal(ws.workspaceId, 'ws-1');
      assert.equal(ws.nodes.length, 1);
    }
  );
});

test('getWorkspaceById falls back to scan when the primary key misses', async () => {
  await patchClient(
    {
      get: () => mockPromise({}),
      scan: () => mockPromise({ Items: [{ workspaceId: 'ws-2', title: 'Scanned' }] }),
    },
    async () => {
      const ws = await DynamoWorkspace.getWorkspaceById('ws-2');
      assert.equal(ws.title, 'Scanned');
    }
  );
});

test('getWorkspaceById returns null when neither get nor scan finds it', async () => {
  await patchClient(
    {
      get: () => mockPromise({}),
      scan: () => mockPromise({ Items: [] }),
    },
    async () => {
      const ws = await DynamoWorkspace.getWorkspaceById('missing');
      assert.equal(ws, null);
    }
  );
});

/* ── Controller: saveWorkspaceCanvas (the calculators' persistence path) ── */
test('PUT saveWorkspaceCanvas persists nodes/edges for an authorised user', async () => {
  const updates = [];
  const puts = [];
  await patchClient(
    {
      get: () => mockPromise({
        Item: {
          workspaceId: 'ws-1',
          projectId: 'PROJ-1',
          status: 'active',
          nodes: [{ id: 'old-node' }],
          edges: [],
          previewSnapshot: null,
        },
      }),
      update: (params) => { updates.push(params); return mockPromise({ Attributes: { workspaceId: 'ws-1' } }); },
      put: (params) => { puts.push(params); return mockPromise({}); },
    },
    async () => {
      const res = createRes();
      const req = {
        params: { id: 'ws-1' },
        body: {
          nodes: [{ id: 'calc-1', type: 'cost-calculator' }],
          edges: [{ id: 'e-1' }],
          layers: [],
          zoomLevel: 150,
          canvasSettings: { grid: true },
        },
        rbac: { isSuperAdmin: true },
        user: { role: 'pm' },
        app: { locals: {} },
      };
      await workspaceController.saveWorkspaceCanvas(req, res);
      assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode} (${JSON.stringify(res.body)})`);
    }
  );
  assert.ok(updates.length > 0 || puts.length > 0, 'canvas save must hit DynamoDB (update or put)');
  const written = updates[0] || puts[0];
  assert.equal(written.TableName, WORKSPACES_TABLE);
});

test('PUT saveWorkspaceCanvas → 404 when the workspace does not exist', async () => {
  await patchClient(
    { get: () => mockPromise({}) },
    async () => {
      const res = createRes();
      await workspaceController.saveWorkspaceCanvas(
        { params: { id: 'missing' }, body: { nodes: [] }, rbac: { isSuperAdmin: true }, user: { role: 'pm' }, app: { locals: {} } },
        res
      );
      assert.equal(res.statusCode, 404);
    }
  );
});

test('PUT saveWorkspaceCanvas → 403 when the requester has no workspace access', async () => {
  await patchClient(
    { get: () => mockPromise({ Item: { workspaceId: 'ws-1', projectId: 'PROJ-1', status: 'active', nodes: [], edges: [] } }) },
    async () => {
      const res = createRes();
      await workspaceController.saveWorkspaceCanvas(
        { params: { id: 'ws-1' }, body: { nodes: [] }, rbac: null, user: { role: 'vendor' }, app: { locals: {} } },
        res
      );
      assert.equal(res.statusCode, 403);
    }
  );
});

/* ── Daily snapshot persistence (added in the 2026-09-30 pull) ── */

const SNAPSHOT_DATA_URL = `data:image/jpeg;base64,${Buffer.from('fake-jpeg-bytes').toString('base64')}`;

test('saveWorkspaceCanvas persists a daily snapshot to S3 for a valid data-URL preview (fire-and-forget)', async () => {
  const uploads = [];
  const dbWrites = [];
  await patchClient(
    {
      get: () => mockPromise({
        Item: { workspaceId: 'ws-1', projectId: 'PROJ-1', status: 'active', nodes: [], edges: [], dailySnapshots: { '2026-09-01': { url: 'old' } } },
      }),
      update: (params) => { dbWrites.push(params); return mockPromise({ Attributes: { workspaceId: 'ws-1' } }); },
      put: (params) => { dbWrites.push(params); return mockPromise({}); },
    },
    async () => {
      await patchS3(
        (params) => {
          uploads.push(params);
          return { promise: () => Promise.resolve({ Location: 'https://s3.test/snap.jpg' }) };
        },
        async () => {
          const res = createRes();
          await workspaceController.saveWorkspaceCanvas(
            {
              params: { id: 'ws-1' },
              body: { nodes: [], edges: [], zoomLevel: 100, previewSnapshot: SNAPSHOT_DATA_URL },
              rbac: { isSuperAdmin: true },
              user: { role: 'pm' },
              app: { locals: {} },
            },
            res
          );
          assert.equal(res.statusCode, 200, 'snapshot persistence must never fail the canvas save');
          // persistDailySnapshot is intentionally not awaited by the controller.
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      );
    }
  );

  assert.equal(uploads.length, 1, 'snapshot image should be uploaded to S3');
  assert.ok(String(uploads[0].Key).startsWith('workspace-snapshots/ws-1/'), `unexpected key: ${uploads[0].Key}`);
  assert.ok(
    dbWrites.some((params) => JSON.stringify(params).includes('dailySnapshots')),
    'workspace.dailySnapshots should be indexed after the upload'
  );
});

test('saveWorkspaceCanvas skips snapshot persistence for a non-data-URL preview', async () => {
  let uploadCalls = 0;
  await patchClient(
    { get: () => mockPromise({ Item: { workspaceId: 'ws-1', projectId: 'PROJ-1', status: 'active', nodes: [], edges: [] } }) },
    async () => {
      await patchS3(
        () => { uploadCalls += 1; return { promise: () => Promise.resolve({ Location: 'x' }) }; },
        async () => {
          const res = createRes();
          await workspaceController.saveWorkspaceCanvas(
            {
              params: { id: 'ws-1' },
              body: { nodes: [], edges: [], previewSnapshot: 'not-a-data-url' },
              rbac: { isSuperAdmin: true },
              user: { role: 'pm' },
              app: { locals: {} },
            },
            res
          );
          assert.equal(res.statusCode, 200);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      );
    }
  );
  assert.equal(uploadCalls, 0, 'invalid previewSnapshot must be ignored silently');
});

/* ── updateProgress progressDate validation (added in the 2026-09-30 pull) ── */

const progressReq = (overrides = {}) => ({
  body: {
    workspaceId: 'ws-1',
    vendorId: 'SAN-1',
    title: 'Day report',
    description: 'Slab work completed',
    workDone: 'slab',
    ...overrides,
  },
});

test('updateProgress rejects a missing progressDate with 400', async () => {
  const res = createRes();
  await workspaceControllerMain.updateProgress(progressReq(), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /progress date is required/i);
});

test('updateProgress rejects an invalid progressDate with 400', async () => {
  const res = createRes();
  await workspaceControllerMain.updateProgress(progressReq({ progressDate: 'not-a-date' }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /progress date is required/i);
});

test('updateProgress normalizes progressDate to YYYY-MM-DD and appends the submission', async () => {
  await patchClient(
    {
      get: () => mockPromise({ Item: { workspaceId: 'ws-1', progress_submissions: [] } }),
      scan: () => mockPromise({ Items: [] }),
      update: () => mockPromise({ Attributes: { workspaceId: 'ws-1' } }),
      put: () => mockPromise({}),
    },
    async () => {
      const res = createRes();
      await workspaceControllerMain.updateProgress(progressReq({ progressDate: '2026-09-29T10:30:00.000Z' }), res);
      assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode} (${JSON.stringify(res.body)})`);
      assert.equal(res.body.data.progress.progressDate, '2026-09-29');
      assert.equal(res.body.data.totalSubmissions, 1);
    }
  );
});
