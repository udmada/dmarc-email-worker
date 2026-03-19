-- D1 Database Schema for DMARC Email Worker
-- Execute this with: wrangler d1 execute dmarc_reports --file=schema.sql

-- DMARC Reports Table
CREATE TABLE IF NOT EXISTS dmarc_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id   TEXT UNIQUE NOT NULL,
  org_name    TEXT NOT NULL,
  domain      TEXT NOT NULL,
  begin_date  INTEGER NOT NULL,
  end_date    INTEGER NOT NULL,
  adkim       TEXT NOT NULL DEFAULT 'r',
  aspf        TEXT NOT NULL DEFAULT 'r',
  policy_p    TEXT NOT NULL,
  policy_sp   TEXT,
  policy_pct  INTEGER,
  raw_xml     TEXT,
  created_at  INTEGER DEFAULT (strftime('%s', 'now'))
);

-- DMARC Records Table (one row per <record> element within a report)
CREATE TABLE IF NOT EXISTS dmarc_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id     TEXT NOT NULL REFERENCES dmarc_reports(report_id),
  source_ip     TEXT NOT NULL,
  count         INTEGER NOT NULL DEFAULT 1,
  disposition   TEXT,
  dkim_result   TEXT,
  spf_result    TEXT,
  header_from   TEXT,
  envelope_from TEXT,
  envelope_to   TEXT,
  auth_results  TEXT,
  created_at    INTEGER DEFAULT (strftime('%s', 'now'))
);

-- TLS-RPT Reports Table (RFC 8460)
CREATE TABLE IF NOT EXISTS tls_reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       TEXT NOT NULL,
  org_name        TEXT NOT NULL,
  policy_domain   TEXT NOT NULL,
  policy_type     TEXT NOT NULL,
  total_success   INTEGER DEFAULT 0,
  total_failures  INTEGER DEFAULT 0,
  failure_details TEXT,
  begin_date      INTEGER NOT NULL,
  end_date        INTEGER NOT NULL,
  created_at      INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dmarc_domain      ON dmarc_reports(domain);
CREATE INDEX IF NOT EXISTS idx_dmarc_begin_date  ON dmarc_reports(begin_date);
CREATE INDEX IF NOT EXISTS idx_dmarc_org_name    ON dmarc_reports(org_name);
CREATE INDEX IF NOT EXISTS idx_records_report_id ON dmarc_records(report_id);
CREATE INDEX IF NOT EXISTS idx_records_source_ip ON dmarc_records(source_ip);
CREATE INDEX IF NOT EXISTS idx_tls_policy_domain ON tls_reports(policy_domain);
CREATE INDEX IF NOT EXISTS idx_tls_begin_date    ON tls_reports(begin_date);
