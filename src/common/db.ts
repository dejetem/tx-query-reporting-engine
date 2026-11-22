import { Pool } from 'pg';
import Redis from 'ioredis';

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgres://reporting:reporting_dev_password@localhost:5433/tx_reporting',
  max: 25,
  idleTimeoutMillis: 30_000,
});

export const redis = new Redis(
  process.env.REDIS_URL ?? 'redis://localhost:6380',
  { maxRetriesPerRequest: null },
);
