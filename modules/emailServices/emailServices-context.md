# Email Services Module — Context

## What This Feature Does
Centralized email sending service for the vendor backend. Sends transactional
emails (invitations, removal notifications, welcome emails) via AWS SES.
Separated from the RBAC module so any module can send emails without coupling
to RBAC's internal structure.

## How It Connects
- **Depends on:** AWS SES (`@aws-sdk/client-ses`), environment vars
  (`SES_FROM_EMAIL`, `AWS_REGION`, `VENDOR_FRONTEND_URL`)
- **Used by:** `modules/rbac/controllers/membersController.js` (invitation +
  removal emails), any future module that needs transactional email
- **API base:** N/A (in-process service, no HTTP routes)

## Key Files
| File | Purpose |
|------|---------|
| `emailService.service.js` | SES client + `sendInvitationEmail`, `sendRemovalEmail` functions |
| `emailTemplates.utils.js` | HTML email template builders (invitation, removal) |
| `emailServices.config.js` | SES config constants (sender, region, frontend URL) |
| `index.js` | Public API barrel export |

## Data Flow
```
membersController.inviteMember
  → emailServices.sendInvitationEmail({to, inviteToken, orgName, roleName, ...})
    → emailTemplates.buildInvitationEmail({...})
    → SES.SendEmailCommand
    → returns {success, messageId}
```

## Important Notes
- SES account is in sandbox mode — recipients must be verified until account
  is moved out of sandbox (request via AWS console).
- All email sends are best-effort: errors are logged but never thrown, so
  the calling mutation (e.g., create invitation) still succeeds.
- `escapeHtml` is applied to all user-supplied content in templates to
  prevent XSS in email clients.
