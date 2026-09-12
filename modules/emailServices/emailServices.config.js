// ============================================================
// FILE: emailServices.config.js
// PURPOSE: Centralized configuration constants for the email
//          services module. SES client, sender address, frontend
//          URL for invite links.
// ============================================================

/** AWS region for SES client. Fail-fast if missing — no silent default. */
export const SES_REGION = (() => {
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error('AWS_REGION must be configured in your .env file.');
  }
  return region;
})();

/** Verified sender address for all transactional emails. */
export const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@caasdiglobal.in';

/**
 * Base URL of the vendor frontend — used to build invite accept links.
 * Falls back to localhost for local dev.
 */
export const VENDOR_FRONTEND_URL = (
  process.env.VENDOR_FRONTEND_URL ||
  process.env.VENDOR_DASH ||
  'http://localhost:5173'
).replace(/\/+$/, '');
