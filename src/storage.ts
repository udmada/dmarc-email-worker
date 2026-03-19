import postgres from "postgres";

import type { DMARCRecord, Env, NormalizedTLSReport, ParsedDMARCReport, ReportId } from "./types";

// Hyperdrive connection singleton
let hyperdriveClient: ReturnType<typeof postgres> | null = null;

function getPostgresClient(env: Env): ReturnType<typeof postgres> | null {
  if (hyperdriveClient === null && env.HYPERDRIVE !== undefined) {
    hyperdriveClient = postgres(env.HYPERDRIVE.connectionString);
  }
  return hyperdriveClient;
}

export async function storeReport(
  report: ParsedDMARCReport,
  analyticsType: "dmarc" | "tlsrpt", // always "dmarc"; reserved for future TLS analytics
  env: Env,
): Promise<void> {
  storeInAnalytics(report, analyticsType, env);
  await Promise.allSettled([
    storeInD1(report, env.DB),
    storeRecordsInD1(report.records, report.reportId, env.DB),
    env.HYPERDRIVE !== undefined ? storeInPostgres(report, env) : Promise.resolve(),
  ]);
}

export async function storeTLSReport(
  report: NormalizedTLSReport,
  env: Pick<Env, "DB">,
): Promise<void> {
  const policies = report.policies ?? [];

  for (const policy of policies) {
    try {
      await env.DB.prepare(
        `
        INSERT INTO tls_reports
        (report_id, org_name, policy_domain, policy_type,
         total_success, total_failures, failure_details, begin_date, end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
        .bind(
          report["report-id"],
          report["organization-name"],
          policy["policy-domain"],
          policy["policy-type"],
          policy.summary["total-successful-session-count"],
          policy.summary["total-failure-session-count"],
          JSON.stringify(policy["failure-details"] ?? []),
          new Date(report["date-range"]["start-datetime"]).getTime() / 1000,
          new Date(report["date-range"]["end-datetime"]).getTime() / 1000,
        )
        .run();
    } catch (e) {
      console.error("TLS-RPT insert failed:", e);
    }
  }
}

export async function storeRecordsInD1(
  records: readonly DMARCRecord[],
  reportId: ReportId,
  db: D1Database,
): Promise<void> {
  if (records.length === 0) return;
  try {
    const stmts = records.map((rec) =>
      db
        .prepare(
          `
          INSERT INTO dmarc_records
          (report_id, source_ip, count, disposition, dkim_result, spf_result,
           header_from, envelope_from, envelope_to, auth_results)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .bind(
          reportId,
          rec.sourceIp,
          rec.count,
          rec.policyEvaluated.disposition,
          rec.policyEvaluated.dkim,
          rec.policyEvaluated.spf,
          rec.headerFrom,
          rec.envelopeFrom,
          rec.envelopeTo,
          JSON.stringify(rec.authResults),
        ),
    );
    await db.batch(stmts);
  } catch (e) {
    console.error("D1 records insert failed:", e);
  }
}

function storeInAnalytics(report: ParsedDMARCReport, type: string, env: Env): void {
  env.ANALYTICS.writeDataPoint({
    blobs: [report.orgName, report.domain, report.reportId, type],
    indexes: [report.domain],
  });
}

async function storeInD1(report: ParsedDMARCReport, db: D1Database): Promise<void> {
  try {
    await db
      .prepare(
        `
      INSERT INTO dmarc_reports
      (report_id, org_name, domain, begin_date, end_date,
       adkim, aspf, policy_p, policy_sp, policy_pct, raw_xml)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (report_id) DO NOTHING
    `,
      )
      .bind(
        report.reportId,
        report.orgName,
        report.domain,
        report.beginDate,
        report.endDate,
        report.adkim,
        report.aspf,
        report.policyP,
        report.policySp,
        report.policyPct,
        report.rawXml,
      )
      .run();
  } catch (e) {
    console.error("D1 insert failed:", e);
  }
}

async function storeInPostgres(report: ParsedDMARCReport, env: Env): Promise<void> {
  const client = getPostgresClient(env);
  if (client === null) return;

  try {
    await client`
      INSERT INTO dmarc_reports
      (report_id, org_name, domain, begin_date, end_date,
       adkim, aspf, policy_p, policy_sp, policy_pct, raw_xml)
      VALUES
      (${report.reportId}, ${report.orgName}, ${report.domain},
       to_timestamp(${report.beginDate}), to_timestamp(${report.endDate}),
       ${report.adkim}, ${report.aspf}, ${report.policyP},
       ${report.policySp}, ${report.policyPct}, ${report.rawXml})
      ON CONFLICT (report_id) DO NOTHING
    `;
  } catch (e) {
    console.error("Postgres insert failed:", e);
  }
}
