// FILE: modules/vendor/controllers/physicalKYCController.js
// PURPOSE: CRUD operations for Physical KYC schedules, checklists, and results
// CONNECTS TO: config/aws.js, modules/vendor/routes/physicalKYCRoutes.js

import { v4 as uuidv4 } from 'uuid';
import {
  dynamoDB,
  PHYSICAL_KYC_SCHEDULES_TABLE,
  PHYSICAL_KYC_CHECKLISTS_TABLE,
  PHYSICAL_KYC_RESULTS_TABLE,
} from '../../../config/aws.js';

// ─── Validation ───────────────────────────────────────────────────────────────

const REQUIRED_SCHEDULE_FIELDS = ['vendorId', 'vendorType', 'scheduledDate', 'scheduledTime', 'location', 'auditType', 'checklistId'];

/**
 * Validates required fields for schedule creation.
 * @param {Object} data
 * @throws {Error} if any required field is missing
 */
const validateScheduleInput = (data) => {
  for (const field of REQUIRED_SCHEDULE_FIELDS) {
    if (!data[field]) {
      throw new Error(`Missing required field: ${field} (vendorId must be provided)`);
    }
  }
};

// ─── Schedule Operations ─────────────────────────────────────────────────────

/**
 * Creates a new physical KYC schedule for a vendor.
 * Sets initial status to 'scheduled' and rescheduleCount to 0.
 * @param {Object} scheduleData
 * @returns {Promise<Object>} created schedule item
 */
export const createSchedule = async (scheduleData) => {
  validateScheduleInput(scheduleData);

  const scheduleId = uuidv4();
  const now = new Date().toISOString();

  const item = {
    vendorId: scheduleData.vendorId,
    scheduleId,
    vendorType: scheduleData.vendorType,
    manufacturerSubType: scheduleData.manufacturerSubType || null,
    scheduledDate: scheduleData.scheduledDate,
    scheduledTime: scheduleData.scheduledTime,
    location: scheduleData.location,
    auditorId: scheduleData.auditorId || null,
    auditFirmId: scheduleData.auditFirmId || null,
    auditType: scheduleData.auditType,
    checklistId: scheduleData.checklistId,
    customChecklistItems: scheduleData.customChecklistItems || [],
    status: 'scheduled',
    rescheduleCount: 0,
    rescheduleRequests: [],
    sixMonthBlockUntil: null,
    createdAt: now,
    updatedAt: now,
  };

  await dynamoDB.put({
    TableName: PHYSICAL_KYC_SCHEDULES_TABLE,
    Item: item,
  }).promise();

  return item;
};

/**
 * Gets the active schedule for a vendor (status: scheduled or in_progress).
 * @param {string} vendorId
 * @returns {Promise<Object|null>}
 */
export const getScheduleByVendorId = async (vendorId) => {
  const result = await dynamoDB.query({
    TableName: PHYSICAL_KYC_SCHEDULES_TABLE,
    KeyConditionExpression: 'vendorId = :vendorId',
    FilterExpression: '#status IN (:s1, :s2)',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':vendorId': vendorId,
      ':s1': 'scheduled',
      ':s2': 'in_progress',
    },
  }).promise();

  return result.Items && result.Items.length > 0 ? result.Items[0] : null;
};

/**
 * Gets a specific schedule by vendorId + scheduleId.
 * @param {string} vendorId
 * @param {string} scheduleId
 * @returns {Promise<Object|null>}
 */
export const getSchedule = async (vendorId, scheduleId) => {
  const result = await dynamoDB.get({
    TableName: PHYSICAL_KYC_SCHEDULES_TABLE,
    Key: { vendorId, scheduleId },
  }).promise();

  return result.Item || null;
};

/**
 * Updates the status of a schedule.
 * @param {string} vendorId
 * @param {string} scheduleId
 * @param {string} status - new status value
 */
export const updateScheduleStatus = async (vendorId, scheduleId, status) => {
  await dynamoDB.update({
    TableName: PHYSICAL_KYC_SCHEDULES_TABLE,
    Key: { vendorId, scheduleId },
    UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': status,
      ':updatedAt': new Date().toISOString(),
    },
  }).promise();
};

/**
 * Handles vendor reschedule request. Max 2 attempts allowed.
 * After 2 failed rescheduled attempts, blocks for 6 months.
 * @param {string} vendorId
 * @param {string} scheduleId
 * @param {string} reason
 * @returns {Promise<{ success: boolean }>}
 */
export const requestReschedule = async (vendorId, scheduleId, reason) => {
  const schedule = await getSchedule(vendorId, scheduleId);

  if (!schedule) {
    throw new Error('Schedule not found');
  }

  if (schedule.rescheduleCount >= 2) {
    throw new Error('Maximum reschedule attempts (2) reached. Vendor blocked for 6 months.');
  }

  const rescheduleRequest = {
    reason,
    status: 'pending',
    requestedAt: new Date().toISOString(),
  };

  const newCount = (schedule.rescheduleCount || 0) + 1;
  const existingRequests = schedule.rescheduleRequests || [];

  // If this is the 2nd reschedule, set the 6-month block after it is reviewed
  const sixMonthBlock = newCount >= 2
    ? new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toISOString()
    : null;

  await dynamoDB.update({
    TableName: PHYSICAL_KYC_SCHEDULES_TABLE,
    Key: { vendorId, scheduleId },
    UpdateExpression:
      'SET rescheduleRequests = :requests, rescheduleCount = :count, sixMonthBlockUntil = :block, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':requests': [...existingRequests, rescheduleRequest],
      ':count': newCount,
      ':block': sixMonthBlock,
      ':updatedAt': new Date().toISOString(),
    },
  }).promise();

  return { success: true };
};

// ─── Checklist Operations ─────────────────────────────────────────────────────

/**
 * Creates a checklist (can be a reusable template or vendor-specific).
 * @param {Object} checklistData
 * @returns {Promise<Object>} created checklist
 */
export const createChecklist = async (checklistData) => {
  const checklistId = uuidv4();
  const now = new Date().toISOString();

  const item = {
    checklistId,
    name: checklistData.name,
    vendorType: checklistData.vendorType,
    manufacturerSubType: checklistData.manufacturerSubType || null,
    verificationMode: checklistData.verificationMode || 'physical',
    sections: checklistData.sections || [],
    isTemplate: checklistData.isTemplate || false,
    createdBy: checklistData.createdBy || 'system',
    createdAt: now,
    updatedAt: now,
  };

  await dynamoDB.put({
    TableName: PHYSICAL_KYC_CHECKLISTS_TABLE,
    Item: item,
  }).promise();

  return item;
};

/**
 * Fetches a checklist by ID.
 * @param {string} checklistId
 * @returns {Promise<Object|null>}
 */
export const getChecklist = async (checklistId) => {
  const result = await dynamoDB.get({
    TableName: PHYSICAL_KYC_CHECKLISTS_TABLE,
    Key: { checklistId },
  }).promise();

  return result.Item || null;
};

/**
 * Queries checklist templates by vendor type and verification mode.
 * @param {string} vendorType
 * @param {string} verificationMode
 * @returns {Promise<Array>}
 */
export const getChecklistTemplates = async (vendorType, verificationMode) => {
  const result = await dynamoDB.query({
    TableName: PHYSICAL_KYC_CHECKLISTS_TABLE,
    IndexName: 'vendorType-verificationMode-index',
    KeyConditionExpression: 'vendorType = :vt AND verificationMode = :vm',
    FilterExpression: 'isTemplate = :isTemplate',
    ExpressionAttributeValues: {
      ':vt': vendorType,
      ':vm': verificationMode,
      ':isTemplate': true,
    },
  }).promise();

  return result.Items || [];
};

// ─── Result Operations ────────────────────────────────────────────────────────

/**
 * Creates a physical KYC result submitted by an auditor.
 * Sets approval status to 'pending_review' for Compliance Lead review.
 * @param {Object} resultData
 * @returns {Promise<Object>} created result
 */
export const createResult = async (resultData) => {
  const resultId = uuidv4();
  const now = new Date().toISOString();

  const item = {
    vendorId: resultData.vendorId,
    scheduleId: resultData.scheduleId,
    resultId,
    auditorId: resultData.auditorId,
    visitDate: resultData.visitDate,
    visitStartTime: resultData.visitStartTime,
    visitEndTime: resultData.visitEndTime,
    checklistResponses: resultData.checklistResponses || {},
    evidenceFiles: resultData.evidenceFiles || [],
    overallResult: resultData.overallResult,
    failureReasons: resultData.failureReasons || [],
    recommendations: resultData.recommendations || [],
    submittedAt: now,
    approvalStatus: 'pending_review',
    approvedBy: [],
    complianceLeadDecision: null,
    createdAt: now,
    updatedAt: now,
  };

  await dynamoDB.put({
    TableName: PHYSICAL_KYC_RESULTS_TABLE,
    Item: item,
  }).promise();

  return item;
};

/**
 * Gets the result for a specific schedule.
 * @param {string} vendorId
 * @param {string} scheduleId
 * @returns {Promise<Object|null>}
 */
export const getResult = async (vendorId, scheduleId) => {
  const result = await dynamoDB.get({
    TableName: PHYSICAL_KYC_RESULTS_TABLE,
    Key: { vendorId, scheduleId },
  }).promise();

  return result.Item || null;
};

/**
 * Updates the compliance lead approval decision on a result.
 * @param {string} vendorId
 * @param {string} scheduleId
 * @param {'approved'|'rejected'} decision
 * @param {string} reviewerId - compliance lead ID
 * @param {string} [reviewNotes]
 */
export const updateComplianceDecision = async (vendorId, scheduleId, decision, reviewerId, reviewNotes) => {
  const now = new Date().toISOString();

  await dynamoDB.update({
    TableName: PHYSICAL_KYC_RESULTS_TABLE,
    Key: { vendorId, scheduleId },
    UpdateExpression:
      'SET approvalStatus = :status, complianceLeadDecision = :decision, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':status': decision === 'approved' ? 'compliance_approved' : 'compliance_rejected',
      ':decision': { reviewerId, decision, reviewNotes: reviewNotes || '', reviewedAt: now },
      ':updatedAt': now,
    },
  }).promise();
};
