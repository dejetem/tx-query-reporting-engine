CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Monthly range-partitioned transactions table for high-volume queries
CREATE TABLE IF NOT EXISTS transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  reference TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('CARD_FUND', 'PAYOUT', 'TRANSFER', 'FEE')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  amount_kobo BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NGN',
  customer_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Partitions for 2026 Q3-Q4 + default
CREATE TABLE IF NOT EXISTS transactions_2026_09 PARTITION OF transactions
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE IF NOT EXISTS transactions_2026_10 PARTITION OF transactions
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE TABLE IF NOT EXISTS transactions_2026_11 PARTITION OF transactions
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

CREATE TABLE IF NOT EXISTS transactions_2026_12 PARTITION OF transactions
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS transactions_default PARTITION OF transactions DEFAULT;

-- Covering composite index for fast keyset/cursor pagination per tenant
CREATE INDEX IF NOT EXISTS idx_tx_tenant_created_id_cover
  ON transactions (tenant_id, created_at DESC, id DESC)
  INCLUDE (reference, type, status, amount_kobo, currency);

-- Partial index for fast lookup of in-flight pending transactions
CREATE INDEX IF NOT EXISTS idx_tx_tenant_pending
  ON transactions (tenant_id, created_at DESC)
  WHERE status = 'PENDING';

-- Async export jobs tracking
CREATE TABLE IF NOT EXISTS export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')) DEFAULT 'QUEUED',
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_path TEXT,
  row_count INT NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
