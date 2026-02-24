// ============================================================
// FILE: invitePublicRoutes.js
// PURPOSE: Public (no-auth) routes for invitation acceptance flow.
//          These are NOT behind authenticateCognitoJwt because the
//          invitee doesn't have an account yet.
// CONNECTS TO: inviteAcceptController.js, server.js (mounted separately)
// ============================================================

import { Router } from 'express';
import { validateInviteToken, acceptInvitation } from '../controllers/inviteAcceptController.js';

const router = Router();

/**
 * GET /api/rbac/invite/validate?token=...
 * Public — returns org name, role, email for the accept page UI.
 */
router.get('/validate', validateInviteToken);

/**
 * POST /api/rbac/invite/accept
 * Public — creates Cognito user, activates member, marks invitation accepted.
 * Body: { token, password, displayName }
 */
router.post('/accept', acceptInvitation);

export default router;
