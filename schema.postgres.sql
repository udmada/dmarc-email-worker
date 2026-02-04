-- PostgreSQL Schema for DMARC Email Worker (via Hyperdrive)
-- Execute this on your PostgreSQL instance

-- DMARC Reports Table
CREATE TABLE IF NOT EXISTS dmarc_reports (
  id SERIAL PRIMARY KEY,
  report_id TEXT UNIQUE NOT NULL,
  org_name TEXT NOT NULL,
  domain TEXT NOT NULL,
  begin_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  dkim_pass INTEGER DEFAULT 0,
  dkim_fail INTEGER DEFAULT 0,
  dkim_temperror INTEGER DEFAULT 0,
  spf_pass INTEGER DEFAULT 0,
  spf_fail INTEGER DEFAULT 0,
  spf_temperror INTEGER DEFAULT 0,
  policy_p TEXT NOT NULL,
  raw_xml TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- TLS-RPT Reports Table (RFC 8460)
CREATE TABLE IF NOT EXISTS tls_reports (
  id SERIAL PRIMARY KEY,
  report_id TEXT NOT NULL,
  org_name TEXT NOT NULL,
  policy_domain TEXT NOT NULL,
  policy_type TEXT NOT NULL,
  total_success INTEGER DEFAULT 0,
  total_failures INTEGER DEFAULT 0,
  failure_details JSONB,
  begin_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_dmarc_domain ON dmarc_reports(domain);
CREATE INDEX IF NOT EXISTS idx_dmarc_begin_date ON dmarc_reports(begin_date);
CREATE INDEX IF NOT EXISTS idx_dmarc_org_name ON dmarc_reports(org_name);
CREATE INDEX IF NOT EXISTS idx_tls_policy_domain ON tls_reports(policy_domain);
CREATE INDEX IF NOT EXISTS idx_tls_begin_date ON tls_reports(begin_date);

-- Advanced PostgreSQL indexes for analytics
CREATE INDEX IF NOT EXISTS idx_dmarc_composite ON dmarc_reports(domain, begin_date DESC);
CREATE INDEX IF NOT EXISTS idx_tls_composite ON tls_reports(policy_domain, begin_date DESC);
