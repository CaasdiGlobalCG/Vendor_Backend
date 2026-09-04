// FILE: modules/vendor/services/otpService.js
// PURPOSE: OTP generation, hashing, and verification for third-party auditor authentication
// CONNECTS TO: modules/vendor/controllers/auditorTokenController.js

import crypto from 'crypto';

/**
 * Generates a cryptographically random 6-digit OTP.
 * @returns {string} 6-digit OTP string
 */
export const generateOTP = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

/**
 * Hashes an OTP with SHA-256 for secure storage.
 * @param {string} otp
 * @returns {string} hex hash
 */
export const hashOTP = (otp) => {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
};

/**
 * Verifies a plain OTP against its stored hash.
 * @param {string} inputOTP - plain text OTP from user
 * @param {string} storedHash - sha256 hash from DB
 * @returns {boolean}
 */
export const verifyOTP = (inputOTP, storedHash) => {
  const inputHash = hashOTP(inputOTP);
  return inputHash === storedHash;
};
