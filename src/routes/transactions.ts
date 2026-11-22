import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, redis } from '../common/db.js';
import { StampedeSafeCache } from '../common/cache.js';

const cache = new StampedeSafeCache(redis);
const LIST_CACHE_TTL_SEC = Number(process.env.LIST_CACHE_TTL_SEC ?? 5);

const listQuerySchema = z.object({
  tenantId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursorCreatedAt: z.string().datetime().optional(),
  cursorId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']).optional(),
});

export async function transactionRoutes(app: FastifyInstance) {
  // Fast keyset/cursor pagination leveraging idx_tx_tenant_created_id_cover + partition pruning
  app.get('/v1/transactions', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { tenantId, limit, cursorCreatedAt, cursorId, status } = parsed.data;
    const params: unknown[] = [tenantId];
    const conditions: string[] = ['tenant_id = $1'];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (cursorCreatedAt && cursorId) {
      params.push(cursorCreatedAt, cursorId);
      conditions.push(
        `(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }

    params.push(limit + 1);
    const sql = `
      SELECT id, reference, type, status, amount_kobo, currency, created_at
      FROM transactions
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}
    `;

    const queryName = status
      ? cursorCreatedAt ? 'tx_list_status_cursor' : 'tx_list_status'
      : cursorCreatedAt ? 'tx_list_cursor' : 'tx_list_base';

    const load = async () => {
      const result = await pool.query({
        name: queryName,
        text: sql,
        values: params,
      });
      const hasMore = result.rows.length > limit;
      const items = hasMore ? result.rows.slice(0, limit) : result.rows;
      const last = items[items.length - 1];

      return {
        items,
        nextCursor: hasMore && last
          ? { cursorCreatedAt: last.created_at, cursorId: last.id }
          : null,
      };
    };

    // Short-TTL cache-aside (single-flight) for list pages; set LIST_CACHE_TTL_SEC=0 to disable.
    if (LIST_CACHE_TTL_SEC <= 0) return load();
    return cache.getOrSet(
      'tx_list',
      `list:${JSON.stringify(params)}`,
      LIST_CACHE_TTL_SEC,
      load,
    );
  });

  // Cached 24h summary with single-flight stampede protection
  app.get('/v1/transactions/summary', async (req, reply) => {
    const tenantId = (req.query as { tenantId?: string }).tenantId;
    if (!tenantId) {
      return reply.code(400).send({ error: 'tenantId is required' });
    }

    return cache.getOrSet(
      'tx_summary_24h',
      `summary:24h:${tenantId}`,
      30,
      async () => {
        const res = await pool.query({
          name: 'tx_summary_24h',
          text: `SELECT
             status,
             COUNT(*)::bigint AS tx_count,
             COALESCE(SUM(amount_kobo), 0)::bigint AS total_kobo
           FROM transactions
           WHERE tenant_id = $1
             AND created_at >= NOW() - INTERVAL '24 hours'
           GROUP BY status`,
          values: [tenantId],
        });
        return { tenantId, window: '24h', breakdown: res.rows };
      },
    );
  });
}
