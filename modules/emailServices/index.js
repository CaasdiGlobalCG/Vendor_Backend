// ============================================================
// FILE: modules/emailServices/index.js
// PURPOSE: Public API barrel export for the email services module.
//          Other modules import from here, never from internal files.
//
// USAGE:
//   import { sendInvitationEmail, sendRemovalEmail }
//     from '../emailServices/index.js';
// ============================================================

export { sendInvitationEmail, sendRemovalEmail } from './emailServices.service.js';
export { buildInvitationEmail, buildRemovalEmail } from './emailTemplates.utils.js';
