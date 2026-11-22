import { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import { z } from 'zod';
import { pool, redis } from '../common/db.js';

const exportQueue = new Queue('exports', { connection: redis });

const createExportSchema = z.object({
  tenantId: z.string().min(1),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export async function exportRoutes(app: FastifyInstance) {
  app.post('/v1/exports', async (req, reply) => {
    const parsed = createExportSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { tenantId, fromDate, toDate } = parsed.data;
    const filters = { fromDate, toDate };

    const res = await pool.query<{ id: string }>(
      `INSERT INTO export_jobs (tenant_id, status, filters)
       VALUES ($1, 'QUEUED', $2)
       RETURNING id`,
      [tenantId, JSON.stringify(filters)],
    );

    const jobId = res.rows[0].id;
    await exportQueue.add(
      'generate-csv',
      { exportJobId: jobId, tenantId, filters },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );

    return reply.code(202).send({ exportJobId: jobId, status: 'QUEUED' });
  });

  app.get('/v1/exports/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await pool.query(
      'SELECT id, tenant_id, status, row_count, file_path, error_message, created_at, completed_at FROM export_jobs WHERE id = $1',
      [id],
    );
    if (!res.rows[0]) {
      return reply.code(404).send({ error: 'Export job not found' });
    }
    return res.rows[0];
  });
}
