import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      '*.cardNumber',
      '*.cvv',
      '*.bvn',
      '*.pin',
      '*.secret',
      '*.customer_email',
    ],
    censor: '[REDACTED]',
  },
});
