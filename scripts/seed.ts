import { Pool } from 'pg';

const TOTAL_ROWS = Number(process.env.ROW_COUNT ?? 1_000_000);
const BATCH_SIZE = 10_000;
const TENANTS = ['tenant-alpha', 'tenant-beta', 'tenant-gamma', 'tenant-delta'];
const TYPES = ['CARD_FUND', 'PAYOUT', 'TRANSFER', 'FEE'];
const STATUSES = ['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED', 'FAILED', 'PENDING'];

async function seed() {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgres://reporting:reporting_dev_password@localhost:5433/tx_reporting',
  });

  console.log(`Seeding ${TOTAL_ROWS.toLocaleString()} rows in batches of ${BATCH_SIZE}...`);
  const start = Date.now();

  for (let offset = 0; offset < TOTAL_ROWS; offset += BATCH_SIZE) {
    const count = Math.min(BATCH_SIZE, TOTAL_ROWS - offset);
    await pool.query(
      `INSERT INTO transactions (tenant_id, reference, type, status, amount_kobo, currency, customer_email, created_at)
       SELECT
         ($1::text[])[1 + (i % 4)],
         'REF-' || ($5 + i)::text,
         ($2::text[])[1 + (i % 4)],
         ($3::text[])[1 + (i % 5)],
         (1000 + (i % 500000))::bigint,
         'NGN',
         'customer' || (i % 50000) || '@example.com',
         TIMESTAMPTZ '2026-09-01' + ((i % 90) || ' days')::interval + ((i % 86400) || ' seconds')::interval
       FROM generate_series(1, $4) AS s(i)`,
      [TENANTS, TYPES, STATUSES, count, offset],
    );

    if ((offset + count) % 100_000 === 0 || offset + count === TOTAL_ROWS) {
      console.log(`Inserted ${(offset + count).toLocaleString()} / ${TOTAL_ROWS.toLocaleString()}`);
    }
  }

  await pool.query('VACUUM ANALYZE transactions;');
  console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
