// FILE: tests/physicalKYC.test.js
// PURPOSE: TDD tests for Physical KYC models and controller
// CONNECTS TO: modules/vendor/models/PhysicalKYCSchedule.js,
//              modules/vendor/controllers/physicalKYCController.js,
//              modules/vendor/services/otpService.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { dynamoDB } from '../config/aws.js';
import * as otpService from '../modules/vendor/services/otpService.js';

// ─── Mock helpers ───────────────────────────────────────────────────────────

function mockPromise(result) {
  return { promise: () => Promise.resolve(result) };
}

function createResMock() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// ─── Save originals ───────────────────────────────────────────────────────────

let originalPut, originalGet, originalQuery, originalUpdate;

test.before(() => {
  originalPut = dynamoDB.put.bind(dynamoDB);
  originalGet = dynamoDB.get.bind(dynamoDB);
  originalQuery = dynamoDB.query.bind(dynamoDB);
  originalUpdate = dynamoDB.update.bind(dynamoDB);
});

test.after(() => {
  dynamoDB.put = originalPut;
  dynamoDB.get = originalGet;
  dynamoDB.query = originalQuery;
  dynamoDB.update = originalUpdate;
});

// ─── PhysicalKYCController tests ─────────────────────────────────────────────

test('createSchedule saves item with correct vendorId and status=scheduled', async () => {
  let capturedParams = null;
  dynamoDB.put = (params) => {
    capturedParams = params;
    return mockPromise({});
  };

  const { createSchedule } = await import('../modules/vendor/controllers/physicalKYCController.js');

  const input = {
    vendorId: 'vendor-001',
    vendorType: 'service_provider',
    scheduledDate: '2026-06-15',
    scheduledTime: '10:00',
    location: '123 Test St, Mumbai',
    auditorId: 'auditor-001',
    auditType: 'internal',
    checklistId: 'checklist-001',
  };

  const result = await createSchedule(input);

  assert.equal(result.vendorId, 'vendor-001');
  assert.equal(result.status, 'scheduled');
  assert.equal(result.rescheduleCount, 0);
  assert.ok(result.scheduleId, 'scheduleId must be set');
  assert.equal(capturedParams.TableName, 'physical_kyc_schedules');
});

test('createSchedule throws when vendorId missing', async () => {
  const { createSchedule } = await import('../modules/vendor/controllers/physicalKYCController.js');

  await assert.rejects(
    () => createSchedule({ scheduledDate: '2026-06-15' }),
    /vendorId/
  );
});

test('getScheduleByVendorId returns active schedule', async () => {
  const mockSchedule = {
    vendorId: 'vendor-001',
    scheduleId: 'sched-001',
    status: 'scheduled',
    scheduledDate: '2026-06-15',
  };

  dynamoDB.query = (params) => {
    assert.equal(params.TableName, 'physical_kyc_schedules');
    return mockPromise({ Items: [mockSchedule] });
  };

  const { getScheduleByVendorId } = await import('../modules/vendor/controllers/physicalKYCController.js');
  const result = await getScheduleByVendorId('vendor-001');

  assert.ok(result);
  assert.equal(result.vendorId, 'vendor-001');
  assert.equal(result.status, 'scheduled');
});

test('getScheduleByVendorId returns null when no schedule', async () => {
  dynamoDB.query = () => mockPromise({ Items: [] });

  const { getScheduleByVendorId } = await import('../modules/vendor/controllers/physicalKYCController.js');
  const result = await getScheduleByVendorId('vendor-999');

  assert.equal(result, null);
});

test('updateScheduleStatus updates status and updatedAt', async () => {
  let capturedParams = null;
  dynamoDB.update = (params) => {
    capturedParams = params;
    return mockPromise({});
  };

  const { updateScheduleStatus } = await import('../modules/vendor/controllers/physicalKYCController.js');
  await updateScheduleStatus('vendor-001', 'sched-001', 'in_progress');

  assert.equal(capturedParams.TableName, 'physical_kyc_schedules');
  assert.ok(capturedParams.ExpressionAttributeValues[':status'] === 'in_progress');
});

test('createChecklist saves with correct fields and isTemplate flag', async () => {
  let capturedParams = null;
  dynamoDB.put = (params) => {
    capturedParams = params;
    return mockPromise({});
  };

  const { createChecklist } = await import('../modules/vendor/controllers/physicalKYCController.js');

  const input = {
    name: 'Service Provider Physical KYC',
    vendorType: 'service_provider',
    verificationMode: 'physical',
    sections: [{ sectionId: 'A', sectionName: 'Entity Identity', items: [] }],
    isTemplate: true,
    createdBy: 'auditor-001',
  };

  const result = await createChecklist(input);

  assert.equal(result.vendorType, 'service_provider');
  assert.equal(result.isTemplate, true);
  assert.ok(result.checklistId);
  assert.equal(capturedParams.TableName, 'physical_kyc_checklists');
});

test('createResult saves with approvalStatus=pending_review', async () => {
  let capturedParams = null;
  dynamoDB.put = (params) => {
    capturedParams = params;
    return mockPromise({});
  };

  const { createResult } = await import('../modules/vendor/controllers/physicalKYCController.js');

  const input = {
    vendorId: 'vendor-001',
    scheduleId: 'sched-001',
    auditorId: 'auditor-001',
    visitDate: '2026-06-15',
    visitStartTime: '10:00',
    visitEndTime: '13:00',
    checklistResponses: {},
    evidenceFiles: [],
    overallResult: 'passed',
  };

  const result = await createResult(input);

  assert.equal(result.approvalStatus, 'pending_review');
  assert.equal(result.vendorId, 'vendor-001');
  assert.equal(capturedParams.TableName, 'physical_kyc_results');
});

test('requestReschedule increments count and adds request', async () => {
  const mockSchedule = {
    vendorId: 'vendor-001',
    scheduleId: 'sched-001',
    status: 'scheduled',
    rescheduleCount: 0,
    rescheduleRequests: [],
  };

  dynamoDB.get = () => mockPromise({ Item: mockSchedule });

  let updateCapture = null;
  dynamoDB.update = (params) => {
    updateCapture = params;
    return mockPromise({});
  };

  const { requestReschedule } = await import('../modules/vendor/controllers/physicalKYCController.js');
  const result = await requestReschedule('vendor-001', 'sched-001', 'Audit team unavailable');

  assert.equal(result.success, true);
  assert.ok(updateCapture);
});

test('requestReschedule throws when max 2 attempts reached', async () => {
  const mockSchedule = {
    vendorId: 'vendor-001',
    scheduleId: 'sched-001',
    rescheduleCount: 2,
  };

  dynamoDB.get = () => mockPromise({ Item: mockSchedule });

  const { requestReschedule } = await import('../modules/vendor/controllers/physicalKYCController.js');

  await assert.rejects(
    () => requestReschedule('vendor-001', 'sched-001', 'Some reason'),
    /maximum reschedule/i
  );
});

// ─── OTP Service tests ────────────────────────────────────────────────────────

test('generateOTP returns 6-digit string', () => {
  const otp = otpService.generateOTP();
  assert.ok(/^\d{6}$/.test(otp), `OTP "${otp}" must be 6 digits`);
});

test('hashOTP returns consistent sha256 hex', () => {
  const otp = '123456';
  const hash1 = otpService.hashOTP(otp);
  const hash2 = otpService.hashOTP(otp);
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64);
});

test('verifyOTP returns true for correct OTP', () => {
  const otp = otpService.generateOTP();
  const hash = otpService.hashOTP(otp);
  assert.equal(otpService.verifyOTP(otp, hash), true);
});

test('verifyOTP returns false for wrong OTP', () => {
  const hash = otpService.hashOTP('111111');
  assert.equal(otpService.verifyOTP('999999', hash), false);
});

// ─── Auditor Token Controller tests ──────────────────────────────────────────

test('generateAuditorToken creates token with expiry and returns tokenId', async () => {
  let capturedParams = null;
  dynamoDB.put = (params) => {
    capturedParams = params;
    return mockPromise({});
  };

  const { generateAuditorToken } = await import('../modules/vendor/controllers/auditorTokenController.js');

  const input = {
    scheduleId: 'sched-001',
    auditorEmail: 'auditor@firm.com',
    auditorName: 'Test Auditor',
    auditFirm: 'Test Firm',
  };

  const result = await generateAuditorToken(input);

  assert.ok(result.tokenId, 'tokenId must be set');
  assert.ok(result.expiresAt, 'expiresAt must be set');
  assert.equal(result.otpVerified, false);
  assert.equal(capturedParams.TableName, 'auditor_access_tokens');
});

test('verifyOTPAndCreateSession rejects expired OTP', async () => {
  const expiredToken = {
    tokenId: 'token-001',
    otpVerified: false,
    otpHash: otpService.hashOTP('123456'),
    otpExpiresAt: new Date(Date.now() - 1000).toISOString(), // expired 1 second ago
  };

  dynamoDB.get = () => mockPromise({ Item: expiredToken });

  const { verifyOTPAndCreateSession } = await import('../modules/vendor/controllers/auditorTokenController.js');

  await assert.rejects(
    () => verifyOTPAndCreateSession('token-001', '123456'),
    /otp expired/i
  );
});

test('verifyOTPAndCreateSession rejects invalid OTP', async () => {
  const token = {
    tokenId: 'token-001',
    otpVerified: false,
    otpHash: otpService.hashOTP('654321'),
    otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min from now
  };

  dynamoDB.get = () => mockPromise({ Item: token });

  const { verifyOTPAndCreateSession } = await import('../modules/vendor/controllers/auditorTokenController.js');

  await assert.rejects(
    () => verifyOTPAndCreateSession('token-001', '999999'),
    /invalid otp/i
  );
});
