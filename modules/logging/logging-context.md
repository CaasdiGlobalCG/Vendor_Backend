# Logging Module Context — Vendor Backend

> **Last updated**: 05-03-2026

## Purpose
Category 3 (Security/Auth Logs) and Category 4 (System/Application Logs) implementation
for the Vendor Backend (ESM / `import-export`).

## Module System
ESM — all files use `import/export` syntax.

## Directory Structure
```
modules/logging/
├── config/logConfig.js        — SECURITY_ACTIONS enum, TTL, table name, source ID
├── services/securityLogger.js — logSecurityEvent() → DynamoDB security_log table
├── middleware/requestLogger.js — Assigns req.requestId, structured JSON console output
├── middleware/errorLogger.js   — Global error handler, structured JSON stderr output
├── utils/uaParser.js          — Lightweight user-agent → browser/OS parser
├── utils/logSanitizer.js      — Strip PII/sensitive fields before logging
└── scripts/createSecurityLogTable.js — One-time DynamoDB table creation
```

## DynamoDB Table
- **Table**: `security_log` (env var: `SECURITY_LOG_TABLE`)
- **PK**: orgId | **SK**: eventId (ISO timestamp + random suffix)
- **GSIs**: ActorIndex (actorId+eventId), ActionIndex (orgId#action+eventId)
- **TTL**: 180 days on `ttl` attribute

## Integration Points
- `cognitoJwtMiddleware.js` — imports `logSecurityEvent` + `SECURITY_ACTIONS`
- `requirePermission.js` — imports `logSecurityEvent` + `SECURITY_ACTIONS` for PERMISSION_DENIED
- `server.js` — mounts `requestLogger` (top) and `errorLogger` (bottom)

## DB Client
Uses shared `docClient` from `modules/rbac/config/db.js` (DynamoDB SDK v3).

## Session Store (sibling module — since 05-03-2026)
- **Table**: `app_sessions` (creation script: `scripts/createSessionTable.js` in Vendor_Backend)
- Replaced in-memory `Map()` with DynamoDB-backed async store in `utils/sessionStore.js`
- Sliding idle TTL (8h) + absolute TTL (7d) + DynamoDB TTL auto-cleanup
- Same table shared by all 3 backends

## Key Patterns
- **Fire-and-forget**: All DynamoDB log writes use `.catch()`, never `await`
- **Structured JSON**: One `JSON.stringify()` per console output
- **Skip paths**: Health checks / favicon excluded from request logs
- **Composite GSI key**: `orgId#action` allows query without FilterExpression

## Security Actions Logged
LOGIN_SUCCESS, LOGIN_FAILED, TOKEN_EXPIRED, TOKEN_INVALID,
PERMISSION_DENIED, SUSPICIOUS_ACTIVITY, PASSWORD_CHANGED,
LOGOUT, TOKEN_REFRESH, ACCOUNT_LOCKED
