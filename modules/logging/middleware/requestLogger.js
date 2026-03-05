// ============================================================
// FILE: requestLogger.js
// PURPOSE: Express middleware that assigns a unique requestId to every
//          incoming request and emits a structured JSON log on completion.
//          Outputs to stdout (→ CloudWatch in production). Zero DynamoDB cost.
// CONNECTS TO: server.js (mounted first in middleware chain),
//              logConfig.js (skip paths, log levels)
// ============================================================

import crypto from 'crypto';
import { LOG_LEVELS, LOG_SOURCE, SKIP_LOG_PATHS } from '../config/logConfig.js';

/**
 * Request logger middleware.
 * - Assigns `req.requestId` (available to ALL downstream handlers)
 * - Logs structured JSON on response finish
 * - Skips health/static paths to reduce noise
 *
 * Mount at the TOP of the middleware chain:
 *   `app.use(requestLogger);`
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requestLogger(req, res, next) {
  // Assign a unique request ID — used by security logger, error logger, etc.
  req.requestId = crypto.randomUUID();

  // Skip noisy endpoints (health checks, favicon)
  if (SKIP_LOG_PATHS.has(req.path)) return next();

  const start = Date.now();

  // Hook into response finish event to capture status + timing
  res.on('finish', () => {
    const duration = Date.now() - start;

    // Determine log level based on HTTP status code
    const level = res.statusCode >= 500 ? LOG_LEVELS.ERROR
               : res.statusCode >= 400 ? LOG_LEVELS.WARN
               : LOG_LEVELS.INFO;

    // Single structured JSON log — one console.log per request
    console.log(JSON.stringify({
      level,
      type: 'REQUEST',
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration,
      userId: req.auth?.sub || req.user?.sub || 'anonymous',
      ip: req.ip || req.connection?.remoteAddress || '',
      userAgent: req.get('user-agent') || '',
      source: LOG_SOURCE,
      timestamp: new Date().toISOString(),
    }));
  });

  next();
}
