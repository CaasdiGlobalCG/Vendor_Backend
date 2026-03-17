import test from 'node:test';
import assert from 'node:assert/strict';

import * as controller from '../modules/support/controllers/supportController.js';
import { dynamoDB, s3 } from '../config/aws.js';

function createRes() {
  return {
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
  };
}

function mockPromise(result) {
  return { promise: () => Promise.resolve(result) };
}

let originalPut;
let originalGet;
let originalScan;
let originalUpdate;
let originalS3PutObject;

test.before(() => {
  originalPut = dynamoDB.put;
  originalGet = dynamoDB.get;
  originalScan = dynamoDB.scan;
  originalUpdate = dynamoDB.update;
  originalS3PutObject = s3.putObject;
});

test.afterEach(() => {
  dynamoDB.put = originalPut;
  dynamoDB.get = originalGet;
  dynamoDB.scan = originalScan;
  dynamoDB.update = originalUpdate;
  s3.putObject = originalS3PutObject;
});

test('vendor createTicket stores vendor portal defaults', async () => {
  let putParams;
  dynamoDB.put = (params) => {
    putParams = params;
    return mockPromise({});
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com', name: 'Vendor User' },
    body: {
      subject: 'Quotation issue',
      description: 'Need help with vendor quotation',
      sourceModule: 'vendor',
    },
    files: [],
  };
  const res = createRes();

  await controller.createTicket(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(putParams.Item.portalType, 'vendor');
  assert.equal(putParams.Item.teamId, 'team-a');
  assert.equal(putParams.Item.raisedById, 'VEN-7');
});

test('vendor getTicket denies access to a different caller', async () => {
  dynamoDB.get = () => mockPromise({
    Item: {
      ticketId: 'CS-2026-20001',
      portalType: 'vendor',
      raisedById: 'VEN-OTHER',
      raisedByEmail: 'other@example.com',
    },
  });

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    params: { ticketId: 'CS-2026-20001' },
  };
  const res = createRes();

  await controller.getTicket(req, res);

  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /access denied/i);
});

test('vendor rateTicket saves rating for resolved tickets', async () => {
  let updateParams;
  dynamoDB.get = () => mockPromise({
    Item: {
      ticketId: 'CS-2026-20002',
      portalType: 'vendor',
      status: 'resolved',
      raisedById: 'VEN-7',
      raisedByEmail: 'vendor@example.com',
    },
  });
  dynamoDB.update = (params) => {
    updateParams = params;
    return mockPromise({});
  };

  const req = {
    vendorId: 'VEN-7',
    auth: { email: 'vendor@example.com' },
    params: { ticketId: 'CS-2026-20002' },
    body: { rating: 5 },
  };
  const res = createRes();

  await controller.rateTicket(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(updateParams.TableName, 'cs_tickets');
  assert.equal(updateParams.ExpressionAttributeValues[':r'], 5);
});

test.todo('vendor listMyTickets should filter portalType to vendor to prevent cross-portal leakage');
test.todo('vendor ticket access checks should reject non-vendor portal tickets even when email overlaps');
test.todo('vendor support should move ticket listing off DynamoDB Scan onto a scoped index');