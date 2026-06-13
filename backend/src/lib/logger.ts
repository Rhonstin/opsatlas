/**
 * Structured logger using pino.
 * - Silent in test (NODE_ENV=test)
 * - requestId auto-injected by pino-http middleware
 * - Credentials are redacted from logs
 */
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.NODE_ENV === 'test' ? { level: 'silent' } : {}),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.cookies',
      'res.headers["set-cookie"]',
      '*.credentials_enc',
      '*.token',
      '*.secret',
      '*.password',
      '*.api_key',
      '*.apiKey',
    ],
    remove: true,
  },
});
