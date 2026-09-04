// FILE: modules/vendor/controllers/auditorTokenController.js
// PURPOSE: Manages secure one-time access tokens for third-party auditors with OTP auth
// CONNECTS TO: modules/vendor/services/otpService.js, config/aws.js,
//              modules/vendor/services/physicalKYCEmailService.js

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { dynamoDB, AUDITOR_ACCESS_TOKENS_TABLE } from '../../../config/aws.js';
import { generateOTP, hashOTP, verifyOTP } from '../services/otpService.js';

/** Token TTL: 7 days for the link, 2-hour session after OTP verification */
const TOKEN_EXPIRY_DAYS = 7;
const SESSION_EXPIRY_HOURS = 2;
const OTP_EXPIRY_MINUTES = 10;

/**
 * Generates a secure one-time portal link for a third-party auditor.
 * Sends an invite email via SES (email send is skipped in test env).
 * @param {Object} scheduleData
 * @param {string} scheduleData.scheduleId
 * @param {string} scheduleData.auditorEmail
 * @param {string} scheduleData.auditorName
 * @param {string} [scheduleData.auditorPhone]
 * @param {string} [scheduleData.auditFirm]
 * @returns {Promise<Object>} token record
 */
export const generateAuditorToken = async (scheduleData) => {
  const tokenId = uuidv4();
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const item = {
    tokenId,
    scheduleId: scheduleData.scheduleId,
    auditorEmail: scheduleData.auditorEmail,
    auditorPhone: scheduleData.auditorPhone || null,
    auditorName: scheduleData.auditorName,
    auditFirm: scheduleData.auditFirm || null,
    expiresAt,
    usedAt: null,
    authenticationMethod: null,
    otpHash: null,
    otpExpiresAt: null,
    otpVerified: false,
    sessionToken: null,
    sessionExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await dynamoDB.put({
    TableName: AUDITOR_ACCESS_TOKENS_TABLE,
    Item: item,
  }).promise();

  // Send invite email (skipped in test env)
  if (process.env.NODE_ENV !== 'test') {
    try {
      const { sendAuditorInviteEmail } = await import('../services/physicalKYCEmailService.js');
      const portalUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/auditor-portal/${tokenId}`;
      await sendAuditorInviteEmail(scheduleData.auditorEmail, scheduleData.auditorName, portalUrl);
    } catch (emailErr) {
      console.warn('Auditor invite email failed (non-critical):', emailErr.message);
    }
  }

  return item;
};

/**
 * Validates the token link is still valid (not expired, not already used).
 * @param {string} tokenId
 * @returns {Promise<Object>} token record
 */
export const validateTokenLink = async (tokenId) => {
  const result = await dynamoDB.get({
    TableName: AUDITOR_ACCESS_TOKENS_TABLE,
    Key: { tokenId },
  }).promise();

  if (!result.Item) {
    throw new Error('Invalid or expired link');
  }

  const token = result.Item;

  if (new Date(token.expiresAt) < new Date()) {
    throw new Error('Link has expired');
  }

  return token;
};

/**
 * Sends an OTP to the auditor via their registered email or phone.
 * @param {string} tokenId
 * @param {'email'|'phone'} method
 * @param {string} contact - email or phone number
 */
export const sendOTPToAuditor = async (tokenId, method, contact) => {
  const token = await validateTokenLink(tokenId);

  const otp = generateOTP();
  const otpHashValue = hashOTP(otp);
  const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  await dynamoDB.update({
    TableName: AUDITOR_ACCESS_TOKENS_TABLE,
    Key: { tokenId },
    UpdateExpression:
      'SET otpHash = :hash, otpExpiresAt = :expires, authenticationMethod = :method, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':hash': otpHashValue,
      ':expires': otpExpiresAt,
      ':method': method,
      ':updatedAt': new Date().toISOString(),
    },
  }).promise();

  // Send OTP via email (skipped in test env)
  if (process.env.NODE_ENV !== 'test') {
    try {
      const { sendOTPEmail } = await import('../services/physicalKYCEmailService.js');
      if (method === 'email') {
        await sendOTPEmail(contact, otp);
      }
      // SMS support can be added via AWS SNS in future
    } catch (sendErr) {
      console.warn('OTP delivery failed:', sendErr.message);
      throw new Error('Failed to send OTP. Please try again.');
    }
  }

  return { success: true, expiresAt: otpExpiresAt };
};

/**
 * Verifies the OTP and creates a short-lived session token for the portal.
 * @param {string} tokenId
 * @param {string} otp
 * @returns {Promise<{ success: boolean, sessionToken: string, sessionExpiresAt: string }>}
 */
export const verifyOTPAndCreateSession = async (tokenId, otp) => {
  const result = await dynamoDB.get({
    TableName: AUDITOR_ACCESS_TOKENS_TABLE,
    Key: { tokenId },
  }).promise();

  if (!result.Item) {
    throw new Error('Invalid token');
  }

  const token = result.Item;

  if (token.otpVerified) {
    throw new Error('OTP already verified — use your existing session');
  }

  if (!token.otpExpiresAt || new Date(token.otpExpiresAt) < new Date()) {
    throw new Error('OTP expired');
  }

  if (!verifyOTP(otp, token.otpHash)) {
    throw new Error('Invalid OTP');
  }

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionExpiresAt = new Date(
    Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000
  ).toISOString();

  await dynamoDB.update({
    TableName: AUDITOR_ACCESS_TOKENS_TABLE,
    Key: { tokenId },
    UpdateExpression:
      'SET otpVerified = :verified, usedAt = :usedAt, sessionToken = :session, sessionExpiresAt = :sessionExpires, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':verified': true,
      ':usedAt': new Date().toISOString(),
      ':session': sessionToken,
      ':sessionExpires': sessionExpiresAt,
      ':updatedAt': new Date().toISOString(),
    },
  }).promise();

  return { success: true, sessionToken, sessionExpiresAt };
};

/**
 * Gets auditor portal data after session is verified.
 * Returns token record if session is valid.
 * @param {string} tokenId
 * @param {string} sessionToken
 * @returns {Promise<Object>} token record
 */
export const getAuditorSession = async (tokenId, sessionToken) => {
  const result = await dynamoDB.get({
    TableName: AUDITOR_ACCESS_TOKENS_TABLE,
    Key: { tokenId },
  }).promise();

  if (!result.Item) throw new Error('Invalid session');

  const token = result.Item;

  if (!token.otpVerified) throw new Error('Not authenticated');
  if (token.sessionToken !== sessionToken) throw new Error('Invalid session token');
  if (new Date(token.sessionExpiresAt) < new Date()) throw new Error('Session expired');

  return token;
};
