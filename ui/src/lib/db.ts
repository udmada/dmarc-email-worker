// D1 row types matching schema.sql
export interface DmarcReportRow {
  report_id: string;
  org_name: string;
  domain: string;
  begin_date: number;
  end_date: number;
  adkim: string;
  aspf: string;
  policy_p: string;
  policy_sp: string | null;
  policy_pct: number | null;
  raw_xml: string | null;
  created_at: number;
}

export interface DmarcRecordRow {
  id: number;
  report_id: string;
  source_ip: string;
  count: number;
  disposition: string | null;
  dkim_result: string | null;
  spf_result: string | null;
  header_from: string | null;
  envelope_from: string | null;
  envelope_to: string | null;
  auth_results: string | null;
  created_at: number;
}

export interface TlsReportRow {
  id: number;
  report_id: string;
  org_name: string;
  policy_domain: string;
  policy_type: string;
  total_success: number;
  total_failures: number;
  failure_details: string | null;
  begin_date: number;
  end_date: number;
  created_at: number;
}

export interface DashboardStats {
  dmarcThisMonth: number;
  tlsThisMonth: number;
  totalDmarcRecords: number;
  dkimPassRate: number;
  spfPassRate: number;
}

const PAGE_SIZE = 20;

export async function getDashboardStats(db: D1Database): Promise<DashboardStats> {
  const monthAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

  const [dmarc, tls, records] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) as n FROM dmarc_reports WHERE begin_date >= ?")
      .bind(monthAgo)
      .first<{ n: number }>(),
    db
      .prepare("SELECT COUNT(*) as n FROM tls_reports WHERE begin_date >= ?")
      .bind(monthAgo)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN dkim_result = 'pass' THEN 1 ELSE 0 END) as dkim_pass,
          SUM(CASE WHEN spf_result = 'pass' THEN 1 ELSE 0 END) as spf_pass
         FROM dmarc_records`,
      )
      .first<{ total: number; dkim_pass: number | null; spf_pass: number | null }>(),
  ]);

  const total = records?.total ?? 0;
  return {
    dmarcThisMonth: dmarc?.n ?? 0,
    tlsThisMonth: tls?.n ?? 0,
    totalDmarcRecords: total,
    dkimPassRate: total > 0 ? Math.round(((records?.dkim_pass ?? 0) / total) * 100) : 0,
    spfPassRate: total > 0 ? Math.round(((records?.spf_pass ?? 0) / total) * 100) : 0,
  };
}

export async function getRecentDmarcReports(db: D1Database, limit = 10): Promise<DmarcReportRow[]> {
  const result = await db
    .prepare("SELECT * FROM dmarc_reports ORDER BY begin_date DESC LIMIT ?")
    .bind(limit)
    .all<DmarcReportRow>();
  return result.results;
}

export interface DmarcReportsPage {
  rows: DmarcReportRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getDmarcReports(
  db: D1Database,
  page: number,
  domain?: string,
  from?: number,
  to?: number,
): Promise<DmarcReportsPage> {
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (domain != null) {
    conditions.push("domain = ?");
    bindings.push(domain);
  }
  if (from != null) {
    conditions.push("begin_date >= ?");
    bindings.push(from);
  }
  if (to != null) {
    conditions.push("begin_date <= ?");
    bindings.push(to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (page - 1) * PAGE_SIZE;

  const [rows, count] = await Promise.all([
    db
      .prepare(`SELECT * FROM dmarc_reports ${where} ORDER BY begin_date DESC LIMIT ? OFFSET ?`)
      .bind(...bindings, PAGE_SIZE, offset)
      .all<DmarcReportRow>(),
    db
      .prepare(`SELECT COUNT(*) as n FROM dmarc_reports ${where}`)
      .bind(...bindings)
      .first<{ n: number }>(),
  ]);

  return { rows: rows.results, total: count?.n ?? 0, page, pageSize: PAGE_SIZE };
}

export async function getDmarcReport(db: D1Database, id: string): Promise<DmarcReportRow | null> {
  return db
    .prepare("SELECT * FROM dmarc_reports WHERE report_id = ?")
    .bind(id)
    .first<DmarcReportRow>();
}

export async function getDmarcRecords(db: D1Database, reportId: string): Promise<DmarcRecordRow[]> {
  const result = await db
    .prepare("SELECT * FROM dmarc_records WHERE report_id = ? ORDER BY count DESC")
    .bind(reportId)
    .all<DmarcRecordRow>();
  return result.results;
}

export interface TlsReportsPage {
  rows: TlsReportRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface GraphPoint {
  day: string;
  total: number;
}

export async function getDailyEmailVolume(db: D1Database, days = 30): Promise<GraphPoint[]> {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const result = await db
    .prepare(
      `SELECT
        date(r.begin_date, 'unixepoch') as day,
        SUM(rec.count) as total
       FROM dmarc_reports r
       JOIN dmarc_records rec ON r.report_id = rec.report_id
       WHERE r.begin_date >= ?
       GROUP BY day
       ORDER BY day ASC`,
    )
    .bind(since)
    .all<GraphPoint>();
  return result.results;
}

export async function getTlsReports(
  db: D1Database,
  page: number,
  domain?: string,
  from?: number,
  to?: number,
): Promise<TlsReportsPage> {
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];
  if (domain != null) {
    conditions.push("policy_domain = ?");
    bindings.push(domain);
  }
  if (from != null) {
    conditions.push("begin_date >= ?");
    bindings.push(from);
  }
  if (to != null) {
    conditions.push("begin_date <= ?");
    bindings.push(to);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (page - 1) * PAGE_SIZE;

  const [rows, count] = await Promise.all([
    db
      .prepare(`SELECT * FROM tls_reports ${where} ORDER BY begin_date DESC LIMIT ? OFFSET ?`)
      .bind(...bindings, PAGE_SIZE, offset)
      .all<TlsReportRow>(),
    db
      .prepare(`SELECT COUNT(*) as n FROM tls_reports ${where}`)
      .bind(...bindings)
      .first<{ n: number }>(),
  ]);

  return { rows: rows.results, total: count?.n ?? 0, page, pageSize: PAGE_SIZE };
}

export async function getTlsReport(db: D1Database, id: number): Promise<TlsReportRow | null> {
  return db.prepare("SELECT * FROM tls_reports WHERE id = ?").bind(id).first<TlsReportRow>();
}

export function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-NZ", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
