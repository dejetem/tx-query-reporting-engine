import { Worker } from 'bullmq';
import { createWriteStream, mkdirSync } from 'fs';
import { join } from 'path';
import { pool, redis } from '../common/db.js';
import { logger } from '../common/logger.js';

const EXPORT_DIR = process.env.EXPORT_DIR ?? '/tmp/exports';
mkdirSync(EXPORT_DIR, { recursive: true });

/**
 * Streams keyset-paginated batches of 5,000 rows directly to a CSV WriteStream
 * to keep worker memory flat regardless of total export size.
 */
export const exportWorker = new Worker<{
  exportJobId: string;
  tenantId: string;
  filters: { fromDate?: string; toDate?: string };
}>(
  'exports',
  async (job) => {
    const { exportJobId, tenantId, filters } = job.data;
    const filePath = join(EXPORT_DIR, `${exportJobId}.csv`);

    await pool.query(
      `UPDATE export_jobs SET status = 'PROCESSING' WHERE id = $1`,
      [exportJobId],
    );

    const stream = createWriteStream(filePath, { encoding: 'utf8' });
    stream.write('id,reference,type,status,amount_kobo,currency,created_at\n');

    let cursorCreatedAt: string | null = null;
    let cursorId: string | null = null;
    let totalRows = 0;
    const batchSize = 5000;

    try {
      while (true) {
        const params: unknown[] = [tenantId];
        const conditions = ['tenant_id = $1'];

        if (filters.fromDate) {
          params.push(filters.fromDate);
          conditions.push(`created_at >= $${params.length}::timestamptz`);
        }
        if (filters.toDate) {
          params.push(filters.toDate);
          conditions.push(`created_at <= $${params.length}::timestamptz`);
        }
        if (cursorCreatedAt && cursorId) {
          params.push(cursorCreatedAt, cursorId);
          conditions.push(
            `(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
          );
        }

        params.push(batchSize);
        const res = await pool.query(
          `SELECT id, reference, type, status, amount_kobo, currency, created_at
           FROM transactions
           WHERE ${conditions.join(' AND ')}
           ORDER BY created_at DESC, id DESC
           LIMIT $${params.length}`,
          params,
        );

        if (res.rows.length === 0) break;

        for (const r of res.rows) {
          const line = `${r.id},${r.reference},${r.type},${r.status},${r.amount_kobo},${r.currency},${new Date(r.created_at).toISOString()}\n`;
          if (!stream.write(line)) {
            await new Promise<void>((resolve) => stream.once('drain', resolve));
          }
        }

        totalRows += res.rows.length;
        const last = res.rows[res.rows.length - 1];
        cursorCreatedAt = last.created_at;
        cursorId = last.id;

        if (res.rows.length < batchSize) break;
      }

      await new Promise<void>((resolve, reject) => {
        stream.end(() => resolve());
        stream.on('error', reject);
      });

      await pool.query(
        `UPDATE export_jobs
         SET status = 'COMPLETED', row_count = $2, file_path = $3, completed_at = NOW()
         WHERE id = $1`,
        [exportJobId, totalRows, filePath],
      );
      logger.info({ exportJobId, totalRows }, 'Export job completed');
    } catch (err) {
      stream.destroy();
      await pool.query(
        `UPDATE export_jobs SET status = 'FAILED', error_message = $2 WHERE id = $1`,
        [exportJobId, err instanceof Error ? err.message : String(err)],
      );
      throw err;
    }
  },
  { connection: redis, concurrency: 2 },
);
