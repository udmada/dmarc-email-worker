import postgres from "postgres";
import type { DMARCReport, Env, TLSReport } from "./types";

// Hyperdrive connection singleton
let hyperdriveClient: ReturnType<typeof postgres> | null = null;

function getPostgresClient(env: Env): ReturnType<typeof postgres> | null {
  if (hyperdriveClient === null && env.HYPERDRIVE !== undefined) {
    hyperdriveClient = postgres(env.HYPERDRIVE.connectionString);
  }
  return hyperdriveClient;
}

export async function storeReport(
  report: DMARCReport,
  type: "dmarc" | "tlsrpt",
  env: Env
): Promise<void> {
  storeInAnalytics(report, type, env);
  await Promise.allSettled([
    storeInD1(report, env.DB),
    env.HYPERDRIVE !== undefined ?
      storeInPostgres(report, env)
    : Promise.resolve(),
  ]);
}

export async function storeTLSReport(
  report: TLSReport,
  env: Env
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
      `
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
          new Date(report["date-range"]["end-datetime"]).getTime() / 1000
        )
        .run();
    } catch (e) {
      console.error("TLS-RPT insert failed:", e);
    }
  }
}

function storeInAnalytics(report: DMARCReport, type: string, env: Env): void {
  env.ANALYTICS.writeDataPoint({
    blobs: [report.orgName, report.domain, report.reportId, type],
    doubles: [
      report.dkimPass,
      report.dkimFail,
      report.dkimTemperror,
      report.spfPass,
      report.spfFail,
      report.spfTemperror,
    ],
    indexes: [report.domain],
  });
}

async function storeInD1(report: DMARCReport, db: D1Database): Promise<void> {
  try {
    await db
      .prepare(
        `
      INSERT INTO dmarc_reports
      (report_id, org_name, domain, begin_date, end_date,
       dkim_pass, dkim_fail, dkim_temperror,
       spf_pass, spf_fail, spf_temperror, policy_p, raw_xml)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (report_id) DO NOTHING
    `
      )
      .bind(
        report.reportId,
        report.orgName,
        report.domain,
        report.beginDate,
        report.endDate,
        report.dkimPass,
        report.dkimFail,
        report.dkimTemperror,
        report.spfPass,
        report.spfFail,
        report.spfTemperror,
        report.policyP,
        report.rawXml
      )
      .run();
  } catch (e) {
    console.error("D1 insert failed:", e);
  }
}

async function storeInPostgres(report: DMARCReport, env: Env): Promise<void> {
  const client = getPostgresClient(env);
  if (client === null) {
    return;
  }

  try {
    await client`
      INSERT INTO dmarc_reports
      (report_id, org_name, domain, begin_date, end_date,
       dkim_pass, dkim_fail, dkim_temperror,
       spf_pass, spf_fail, spf_temperror, policy_p, raw_xml)
      VALUES
      (${report.reportId}, ${report.orgName}, ${report.domain},
       to_timestamp(${report.beginDate}), to_timestamp(${report.endDate}),
       ${report.dkimPass}, ${report.dkimFail}, ${report.dkimTemperror},
       ${report.spfPass}, ${report.spfFail}, ${report.spfTemperror},
       ${report.policyP}, ${report.rawXml})
      ON CONFLICT (report_id) DO NOTHING
    `;
  } catch (e) {
    console.error("Postgres insert failed:", e);
  }
}
