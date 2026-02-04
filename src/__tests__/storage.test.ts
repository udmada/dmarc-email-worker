import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { storeTLSReport } from "../storage";
import type { TLSReport } from "../types";

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS dmarc_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id TEXT UNIQUE NOT NULL,
        org_name TEXT NOT NULL,
        domain TEXT NOT NULL,
        begin_date INTEGER NOT NULL,
        end_date INTEGER NOT NULL,
        dkim_pass INTEGER DEFAULT 0,
        dkim_fail INTEGER DEFAULT 0,
        dkim_temperror INTEGER DEFAULT 0,
        spf_pass INTEGER DEFAULT 0,
        spf_fail INTEGER DEFAULT 0,
        spf_temperror INTEGER DEFAULT 0,
        policy_p TEXT NOT NULL,
        raw_xml TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS tls_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id TEXT NOT NULL,
        org_name TEXT NOT NULL,
        policy_domain TEXT NOT NULL,
        policy_type TEXT NOT NULL,
        total_success INTEGER DEFAULT 0,
        total_failures INTEGER DEFAULT 0,
        failure_details TEXT,
        begin_date INTEGER NOT NULL,
        end_date INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `),
  ]);
});

describe("storeTLSReport", () => {
  it("inserts a TLS-RPT report into D1", async () => {
    const report: TLSReport = {
      "organization-name": "google.com",
      "date-range": {
        "start-datetime": "2024-01-01T00:00:00Z",
        "end-datetime": "2024-01-01T23:59:59Z",
      },
      "contact-info": "mailto:tls@google.com",
      "report-id": "tls-store-test",
      "policies": [
        {
          "policy-type": "sts",
          "policy-domain": "example.com",
          "summary": {
            "total-successful-session-count": 50,
            "total-failure-session-count": 3,
          },
          "failure-details": [
            {
              "result-type": "certificate-expired",
              "sending-mta-ip": "10.0.0.1",
              "receiving-mx-hostname": "mx.example.com",
              "failed-session-count": 3,
            },
          ],
        },
      ],
    };

    await storeTLSReport(report, env);

    const result = await env.DB.prepare(
      "SELECT * FROM tls_reports WHERE report_id = ?"
    )
      .bind("tls-store-test")
      .first();

    expect(result).not.toBeNull();

    if (result === null) {
      return;
    }
    expect(result["org_name"]).toBe("google.com");
    expect(result["policy_domain"]).toBe("example.com");
    expect(result["policy_type"]).toBe("sts");
    expect(result["total_success"]).toBe(50);
    expect(result["total_failures"]).toBe(3);
  });

  it("inserts multiple policies from one report", async () => {
    const report: TLSReport = {
      "organization-name": "multi-policy.com",
      "date-range": {
        "start-datetime": "2024-02-01T00:00:00Z",
        "end-datetime": "2024-02-01T23:59:59Z",
      },
      "contact-info": "mailto:tls@multi.com",
      "report-id": "tls-multi-policy",
      "policies": [
        {
          "policy-type": "sts",
          "policy-domain": "a.com",
          "summary": {
            "total-successful-session-count": 10,
            "total-failure-session-count": 0,
          },
        },
        {
          "policy-type": "dane",
          "policy-domain": "b.com",
          "summary": {
            "total-successful-session-count": 20,
            "total-failure-session-count": 1,
          },
        },
      ],
    };

    await storeTLSReport(report, env);

    const results = await env.DB.prepare(
      "SELECT * FROM tls_reports WHERE report_id = ? ORDER BY policy_domain"
    )
      .bind("tls-multi-policy")
      .all();

    expect(results.results).toHaveLength(2);
    expect(results.results[0]["policy_domain"]).toBe("a.com");
    expect(results.results[1]["policy_domain"]).toBe("b.com");
    expect(results.results[1]["policy_type"]).toBe("dane");
  });

  it("handles a report with no policies without error", async () => {
    const report: TLSReport = {
      "organization-name": "empty.com",
      "date-range": {
        "start-datetime": "2024-01-01T00:00:00Z",
        "end-datetime": "2024-01-01T23:59:59Z",
      },
      "contact-info": "mailto:tls@empty.com",
      "report-id": "tls-no-policies",
    };

    await expect(storeTLSReport(report, env)).resolves.toBeUndefined();

    const result = await env.DB.prepare(
      "SELECT * FROM tls_reports WHERE report_id = ?"
    )
      .bind("tls-no-policies")
      .first();

    expect(result).toBeNull();
  });
});
