import { startTelemetry } from './telemetry/tracing.js';
startTelemetry();

import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { logger } from './common/logger.js';
import { redis } from './common/db.js';
import { httpRequestDuration, registry } from './telemetry/metrics.js';
import { transactionRoutes } from './routes/transactions.js';
import { exportRoutes } from './routes/exports.js';

async function main() {
  const app = Fastify({ loggerInstance: logger });

  const rateLimitMax = Number(process.env.RATE_LIMIT_MAX ?? 50_000);
  await app.register(rateLimit, {
    max: rateLimitMax,
    timeWindow: '1 minute',
    ...(process.env.USE_REDIS_RATE_LIMIT === 'true' ? { redis } : {}),
  });

  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? req.url;
    httpRequestDuration.observe(
      {
        method: req.method,
        route,
        status_code: String(reply.statusCode),
      },
      reply.elapsedTime / 1000,
    );
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(transactionRoutes);
  await app.register(exportRoutes);

  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  logger.error(err, 'Failed to start server');
  process.exit(1);
});
