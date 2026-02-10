import type { TLSReport } from "./types";

function isTLSReport(obj: unknown): obj is TLSReport {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  return (
    "organization-name" in obj &&
    typeof obj["organization-name"] === "string" &&
    "report-id" in obj &&
    typeof obj["report-id"] === "string" &&
    "date-range" in obj &&
    typeof obj["date-range"] === "object" &&
    obj["date-range"] !== null
  );
}

export function parseTLSReport(content: string): TLSReport | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (isTLSReport(parsed)) {
      return parsed;
    }
    console.error("Invalid TLS-RPT structure");
    return null;
  } catch (error) {
    console.error("Failed to parse TLS-RPT JSON:", error);
    return null;
  }
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const VALID_TLS_REPORT = JSON.stringify({
    "organization-name": "google.com",
    "date-range": {
      "start-datetime": "2024-01-01T00:00:00Z",
      "end-datetime": "2024-01-01T23:59:59Z",
    },
    "contact-info": "mailto:tls-report@google.com",
    "report-id": "tls-abc123",
    "policies": [
      {
        "policy-type": "sts",
        "policy-domain": "example.com",
        "summary": {
          "total-successful-session-count": 100,
          "total-failure-session-count": 2,
        },
        "failure-details": [
          {
            "result-type": "certificate-expired",
            "sending-mta-ip": "1.2.3.4",
            "receiving-mx-hostname": "mx.example.com",
            "failed-session-count": 2,
          },
        ],
      },
    ],
  });

  describe("parseTLSReport", () => {
    it("parses a valid TLS-RPT report", () => {
      const report = parseTLSReport(VALID_TLS_REPORT);
      expect(report).not.toBeNull();

      if (report === null) {
        return;
      }
      expect(report["organization-name"]).toBe("google.com");
      expect(report["report-id"]).toBe("tls-abc123");
      expect(report["date-range"]["start-datetime"]).toBe("2024-01-01T00:00:00Z");
      expect(report.policies).toHaveLength(1);

      const policy = report.policies?.[0];
      expect(policy?.["policy-type"]).toBe("sts");
      expect(policy?.summary["total-successful-session-count"]).toBe(100);
    });

    it("parses a report with no policies", () => {
      const json = JSON.stringify({
        "organization-name": "test.com",
        "date-range": {
          "start-datetime": "2024-01-01T00:00:00Z",
          "end-datetime": "2024-01-01T23:59:59Z",
        },
        "contact-info": "mailto:test@test.com",
        "report-id": "no-policies",
      });

      const report = parseTLSReport(json);
      expect(report).not.toBeNull();

      if (report === null) {
        return;
      }
      expect(report["report-id"]).toBe("no-policies");
      expect(report.policies).toBeUndefined();
    });

    it("returns null for invalid JSON", () => {
      const report = parseTLSReport("not valid json {{{");

      expect(report).toBeNull();
    });

    it("returns null when organization-name is missing", () => {
      const json = JSON.stringify({
        "date-range": {
          "start-datetime": "2024-01-01T00:00:00Z",
          "end-datetime": "2024-01-01T23:59:59Z",
        },
        "report-id": "missing-org",
      });

      const report = parseTLSReport(json);

      expect(report).toBeNull();
    });

    it("returns null when report-id is missing", () => {
      const json = JSON.stringify({
        "organization-name": "test.com",
        "date-range": {
          "start-datetime": "2024-01-01T00:00:00Z",
          "end-datetime": "2024-01-01T23:59:59Z",
        },
      });

      const report = parseTLSReport(json);

      expect(report).toBeNull();
    });

    it("returns null when date-range is missing", () => {
      const json = JSON.stringify({
        "organization-name": "test.com",
        "report-id": "no-dates",
      });

      const report = parseTLSReport(json);

      expect(report).toBeNull();
    });

    it("returns null for non-object JSON", () => {
      expect(parseTLSReport('"just a string"')).toBeNull();
      expect(parseTLSReport("42")).toBeNull();
      expect(parseTLSReport("null")).toBeNull();
      expect(parseTLSReport("[]")).toBeNull();
    });
  });
}
