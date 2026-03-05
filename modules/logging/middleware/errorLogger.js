// ============================================================
// FILE: errorLogger.js
// PURPOSE: Global Express error handler (4-arg middleware).
//          Emits structured JSON error logs to stderr (→ CloudWatch).
//          Replaces the generic `console.error(err.stack)` pattern.
// CONNECTS TO: server.js (mounted LAST in middleware chain)
// ============================================================

import { LOG_SOURCE } from '../config/logConfig.js';
import { sanitize } from '../utils/logSanitizer.js';

/**
 * Global error logging middleware.
 * Must be mounted AFTER all routes:
 *   `app.use(errorLogger);`
 *
 * WHY: Captures unhandled errors with full request context, outputs structured
 * JSON so CloudWatch Logs Insights can query by error type, route, user, etc.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next — required for Express to recognise this as error middleware
 */
export function errorLogger(err, req, res, _next) {
  const isProd = process.env.NODE_ENV === 'production';

  // Structured error log — single JSON output
  console.error(JSON.stringify({
    level: 'ERROR',
    type: 'UNHANDLED_ERROR',
    requestId: req.requestId || '',
    method: req.method,
    url: req.originalUrl,
    error: {
      message: err.message,
      name: err.name,
      code: err.code || undefined,
      // Only include stack in non-production to avoid leaking internals
      stack: isProd ? undefined : err.stack,
    },
    userId: req.auth?.sub || req.user?.sub || 'anonymous',
    orgId: req.rbac?.orgId || 'unknown',
    body: sanitize(req.body),
    source: LOG_SOURCE,
    timestamp: new Date().toISOString(),
  }));

  // Send response if not already sent
  if (!res.headersSent) {
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      error: isProd ? 'Internal Server Error' : err.message,
      requestId: req.requestId || undefined,
    });
  }
}
