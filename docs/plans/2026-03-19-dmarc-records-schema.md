# DMARC Records Schema Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the D1 schema with a `dmarc_records` table (one row per `<record>` element) and refactor types, parser, and storage to write per-record data, enabling a future UI showing per-sender/per-IP breakdowns.

**Architecture:** Five interdependent files change together (types → parser → storage → tests → index). Because the pre-commit hook runs oxlint project-wide, all five tasks must pass type-check and tests before any commit is made. Tasks 1–5 are committed together in one commit. Task 6 (migration endpoint) and Task 7 (deploy + migrate) each get their own commits.

**Tech Stack:** TypeScript, Cloudflare Workers D1, vitest, oxlint, oxfmt

**Design doc:** `docs/plans/2026-03-19-dmarc-records-schema-design.md`

---

### Task 1: Update `src/types.ts` — new DMARC types

**Files:**

- Modify: `src/types.ts`

**Context:** The current `DMARCReport` stores aggregate counts (`dkimPass`, `dkimFail`, etc.). Replace it entirely with a generic `DMARCReport<R>`, branded primitives, const-derived union types, a `DKIMAuthResult | SPFAuthResult` discriminated union, and type guards. Keep the TLS-RPT types at the bottom unchanged.

**Step 1: Write failing inline vitest tests for the type guards**

Add this block at the bottom of `src/types.ts` (before the TLS-RPT section, after the type guard functions):

```typescript
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("AuthResult type guards", () => {
    it("isDKIMAuthResult returns true for dkim, false for spf", () => {
      const dkim: AuthResult = {
        type: "dkim",
        domain: "example.com" as Domain,
        selector: "s1",
        result: "pass",
      };
      const spf: AuthResult = {
        type: "spf",
        domain: "example.com" as Domain,
        result: "pass",
      };
      expect(isDKIMAuthResult(dkim)).toBe(true);
      expect(isDKIMAuthResult(spf)).toBe(false);
    });

    it("isSPFAuthResult returns true for spf, false for dkim", () => {
      const dkim: AuthResult = {
        type: "dkim",
        domain: "example.com" as Domain,
        selector: "s1",
        result: "fail",
      };
      const spf: AuthResult = {
        type: "spf",
        domain: "example.com" as Domain,
        result: "fail",
      };
      expect(isSPFAuthResult(spf)).toBe(true);
      expect(isSPFAuthResult(dkim)).toBe(false);
    });

    it("isDKIMAuthResult narrows to DKIMAuthResult with selector", () => {
      const r: AuthResult = {
        type: "dkim",
        domain: "example.com" as Domain,
        selector: "key1",
        result: "pass",
      };
      if (isDKIMAuthResult(r)) {
        expect(r.selector).toBe("key1");
      }
    });
  });
}
```

**Step 2: Run tests to verify they fail**

```bash
pnpm test 2>&1 | grep -E "FAIL|AuthResult|Cannot find"
```

Expected: errors because `AuthResult`, `isDKIMAuthResult`, `Domain` etc. don't exist yet.

**Step 3: Replace `src/types.ts` with the new design**

Replace the entire `DMARCReport` interface and everything below it (but preserve `Env`, `ReplyMessage`, and TLS-RPT types). The new file:

```typescript
export interface Env {
  ANALYTICS: AnalyticsEngineDataset;
  DB: D1Database;
  HYPERDRIVE?: Hyperdrive;
  EMAIL?: SendEmail;
  EMAIL_QUEUE?: Queue<ReplyMessage>;
  R2_BUCKET: R2Bucket;
  RATE_LIMIT: RateLimit;
  SENDER_EMAIL: string;
  SENDER_DOMAIN: string;
}

export interface ReplyMessage {
  messageId: string;
  replyTo: string;
  reportId: string;
  subject: string;
}

// ---------------------------------------------------------------------------
// Branded primitives — prevents mixing domain/IP/reportId strings at type level
// ---------------------------------------------------------------------------

type Brand<T, B extends string> = T & { readonly _brand: B };
export type SourceIP = Brand<string, "SourceIP">;
export type Domain = Brand<string, "Domain">;
export type ReportId = Brand<string, "ReportId">;

// ---------------------------------------------------------------------------
// Const maps → derived union types (single source of truth, no duplication)
// ---------------------------------------------------------------------------

const DMARC_ALIGNMENT = { r: "r", s: "s" } as const;
export type DMARCAlignment = keyof typeof DMARC_ALIGNMENT;

const DMARC_DISPOSITION = {
  none: "none",
  quarantine: "quarantine",
  reject: "reject",
} as const;
export type DMARCDisposition = keyof typeof DMARC_DISPOSITION;

const DMARC_AUTH_RESULT_TYPE = {
  pass: "pass",
  fail: "fail",
  temperror: "temperror",
  permerror: "permerror",
  neutral: "neutral",
  none: "none",
} as const;
export type DMARCAuthResultType = keyof typeof DMARC_AUTH_RESULT_TYPE;

// Extract from existing union — no duplication
export type DMARCPassFail = Extract<DMARCAuthResultType, "pass" | "fail">;

// ---------------------------------------------------------------------------
// AuthResult discriminated union — DKIM has selector, SPF structurally does not
// ---------------------------------------------------------------------------

export interface DKIMAuthResult {
  readonly type: "dkim";
  readonly domain: Domain;
  readonly selector: string;
  readonly result: DMARCAuthResultType;
}

export interface SPFAuthResult {
  readonly type: "spf";
  readonly domain: Domain;
  readonly result: DMARCAuthResultType;
}

export type AuthResult = DKIMAuthResult | SPFAuthResult;

// Generic narrowing utility — avoids manually restating interface names
export type AuthResultForType<T extends AuthResult["type"]> = Extract<AuthResult, { type: T }>;

// Type guards — normalize at parse boundary (same pattern as isGooglePolicy in tlsrpt.ts)
export function isDKIMAuthResult(r: AuthResult): r is AuthResultForType<"dkim"> {
  return r.type === "dkim";
}

export function isSPFAuthResult(r: AuthResult): r is AuthResultForType<"spf"> {
  return r.type === "spf";
}

// ---------------------------------------------------------------------------
// Core DMARC interfaces
// ---------------------------------------------------------------------------

export interface PolicyEvaluated {
  readonly disposition: DMARCDisposition;
  readonly dkim: DMARCPassFail;
  readonly spf: DMARCPassFail;
}

export interface DMARCRecord {
  readonly sourceIp: SourceIP;
  readonly count: number;
  readonly policyEvaluated: PolicyEvaluated;
  readonly headerFrom: Domain;
  readonly envelopeFrom: Domain;
  readonly envelopeTo: Domain;
  readonly authResults: readonly AuthResult[];
}

// Generic report — R parameterises whether records are present
export interface DMARCReport<R extends readonly DMARCRecord[] = readonly DMARCRecord[]> {
  readonly reportId: ReportId;
  readonly orgName: string;
  readonly domain: Domain;
  readonly beginDate: number;
  readonly endDate: number;
  readonly adkim: DMARCAlignment;
  readonly aspf: DMARCAlignment;
  readonly policyP: DMARCDisposition;
  readonly policySp: DMARCDisposition;
  readonly policyPct: number;
  readonly rawXml: string;
  readonly records: R;
}

// Named variants used at call sites
export type ParsedDMARCReport = DMARCReport<readonly DMARCRecord[]>;
export type StoredDMARCReport = DMARCReport<readonly []>;

// ---------------------------------------------------------------------------
// RFC 8460 TLS-RPT (kebab-case per spec) — unchanged
// ---------------------------------------------------------------------------

export type PolicyType = "sts" | "dane" | "dane-only" | "no-policy-found";

export interface TLSFailureDetail {
  "result-type": string;
  "sending-mta-ip": string;
  "receiving-mx-hostname": string;
  "failed-session-count": number;
}

export interface TLSPolicySummary {
  "total-successful-session-count": number;
  "total-failure-session-count": number;
}

// RFC 8460 §5.2: policy-type and policy-domain at top level
export interface RFCPolicy {
  "policy-type": PolicyType;
  "policy-domain": string;
  "summary": TLSPolicySummary;
  "failure-details"?: TLSFailureDetail[];
}

// Google's non-standard format: policy fields nested under "policy"
export interface GooglePolicy {
  "policy": {
    "policy-type": PolicyType;
    "policy-domain": string;
  };
  "summary": TLSPolicySummary;
  "failure-details"?: TLSFailureDetail[];
}

export type RawTLSPolicy = RFCPolicy | GooglePolicy;

export interface TLSReport {
  "organization-name": string;
  "date-range": {
    "start-datetime": string;
    "end-datetime": string;
  };
  "contact-info": string;
  "report-id": string;
  "policies"?: RawTLSPolicy[];
}

export type NormalizedTLSReport = Omit<TLSReport, "policies"> & { policies?: RFCPolicy[] };
```

Then add the inline vitest block from Step 1 at the bottom.

**Step 4: Run type-check**

```bash
pnpm exec tsc --noEmit 2>&1 | grep "error TS"
```

Expected: errors in `dmarc.ts` and `storage.ts` (they reference old `DMARCReport` shape — fixed in Tasks 3 and 4). Do NOT commit yet.

---

### Task 2: Update `schema.sql`

**Files:**

- Modify: `schema.sql`

**Context:** D1 does not support `DROP COLUMN`, so the new `schema.sql` reflects the final desired shape for fresh deploys only. The remote migration is handled separately (Task 7).

**Step 1: Replace `dmarc_reports` and add `dmarc_records`**

Replace the full contents of `schema.sql`:

```sql
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
CREATE INDEX IF NOT EXISTS idx_dmarc_domain     ON dmarc_reports(domain);
CREATE INDEX IF NOT EXISTS idx_dmarc_begin_date ON dmarc_reports(begin_date);
CREATE INDEX IF NOT EXISTS idx_dmarc_org_name   ON dmarc_reports(org_name);
CREATE INDEX IF NOT EXISTS idx_records_report_id ON dmarc_records(report_id);
CREATE INDEX IF NOT EXISTS idx_records_source_ip ON dmarc_records(source_ip);
CREATE INDEX IF NOT EXISTS idx_tls_policy_domain ON tls_reports(policy_domain);
CREATE INDEX IF NOT EXISTS idx_tls_begin_date    ON tls_reports(begin_date);
```

No tests for schema files. Do NOT commit yet.

---

### Task 3: Rewrite `src/dmarc.ts` — return `ParsedDMARCReport`

**Files:**

- Modify: `src/dmarc.ts`

**Context:** The parser currently aggregates auth results into pass/fail counts and discards all per-record data. Rewrite it to build a `DMARCRecord[]` from the XML `<record>` elements. The XML interface types (`XMLRow`, `XMLAuthResult`, `XMLIdentifiers`, `XMLPolicyEvaluated`) already capture all needed fields — they just weren't used.

**Step 1: Update inline vitest tests to assert per-record structure**

Replace the entire `if (import.meta.vitest)` block in `src/dmarc.ts`:

```typescript
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("parseDMARCReportFromString", () => {
    it("parses report metadata and policy_published fields", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feedback>
  <report_metadata>
    <org_name>google.com</org_name>
    <report_id>abc123</report_id>
    <date_range>
      <begin>1704067200</begin>
      <end>1704153599</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>example.com</domain>
    <adkim>s</adkim>
    <aspf>r</aspf>
    <p>reject</p>
    <sp>none</sp>
    <pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>1.2.3.4</source_ip>
      <count>5</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>example.com</header_from>
      <envelope_from>example.com</envelope_from>
    </identifiers>
    <auth_results>
      <dkim><domain>example.com</domain><selector>s1</selector><result>pass</result></dkim>
      <spf><domain>example.com</domain><result>pass</result></spf>
    </auth_results>
  </record>
</feedback>`;

      const report = parseDMARCReportFromString(xml);

      expect(report.reportId).toBe("abc123");
      expect(report.orgName).toBe("google.com");
      expect(report.domain).toBe("example.com");
      expect(report.beginDate).toBe(1704067200);
      expect(report.endDate).toBe(1704153599);
      expect(report.adkim).toBe("s");
      expect(report.aspf).toBe("r");
      expect(report.policyP).toBe("reject");
      expect(report.policySp).toBe("none");
      expect(report.policyPct).toBe(100);
      expect(report.rawXml).toBe(xml);
    });

    it("parses per-record data: source_ip, count, policyEvaluated, identifiers", () => {
      const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>yahoo.com</org_name>
    <report_id>rec-test</report_id>
    <date_range><begin>1000</begin><end>2000</end></date_range>
  </report_metadata>
  <policy_published><domain>test.com</domain><p>quarantine</p></policy_published>
  <record>
    <row>
      <source_ip>10.0.0.1</source_ip>
      <count>3</count>
      <policy_evaluated>
        <disposition>quarantine</disposition>
        <dkim>fail</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>test.com</header_from>
      <envelope_from>bounce.test.com</envelope_from>
      <envelope_to>inbox@example.com</envelope_to>
    </identifiers>
    <auth_results>
      <dkim><domain>test.com</domain><selector>key1</selector><result>fail</result></dkim>
      <spf><domain>test.com</domain><result>pass</result></spf>
    </auth_results>
  </record>
</feedback>`;

      const report = parseDMARCReportFromString(xml);

      expect(report.records).toHaveLength(1);
      const rec = report.records[0];
      expect(rec.sourceIp).toBe("10.0.0.1");
      expect(rec.count).toBe(3);
      expect(rec.policyEvaluated.disposition).toBe("quarantine");
      expect(rec.policyEvaluated.dkim).toBe("fail");
      expect(rec.policyEvaluated.spf).toBe("pass");
      expect(rec.headerFrom).toBe("test.com");
      expect(rec.envelopeFrom).toBe("bounce.test.com");
      expect(rec.envelopeTo).toBe("inbox@example.com");
    });

    it("parses authResults into DKIMAuthResult and SPFAuthResult", () => {
      const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>test</org_name>
    <report_id>auth-test</report_id>
    <date_range><begin>0</begin><end>0</end></date_range>
  </report_metadata>
  <policy_published><domain>d.com</domain><p>none</p></policy_published>
  <record>
    <row>
      <source_ip>1.1.1.1</source_ip>
      <count>1</count>
      <policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated>
    </row>
    <auth_results>
      <dkim><domain>d.com</domain><selector>sel1</selector><result>pass</result></dkim>
      <spf><domain>d.com</domain><result>pass</result></spf>
    </auth_results>
  </record>
</feedback>`;

      const report = parseDMARCReportFromString(xml);
      const authResults = report.records[0].authResults;

      expect(authResults).toHaveLength(2);

      const dkim = authResults.find((r) => r.type === "dkim");
      const spf = authResults.find((r) => r.type === "spf");

      expect(dkim?.type).toBe("dkim");
      expect(dkim?.domain).toBe("d.com");
      if (dkim?.type === "dkim") {
        expect(dkim.selector).toBe("sel1");
      }

      expect(spf?.type).toBe("spf");
      expect(spf?.domain).toBe("d.com");
    });

    it("parses multiple records", () => {
      const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>yahoo.com</org_name>
    <report_id>multi-rec</report_id>
    <date_range><begin>1000</begin><end>2000</end></date_range>
  </report_metadata>
  <policy_published><domain>test.com</domain><p>quarantine</p></policy_published>
  <record>
    <row><source_ip>1.1.1.1</source_ip><count>2</count>
      <policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated>
    </row>
    <auth_results><dkim><result>pass</result></dkim><spf><result>pass</result></spf></auth_results>
  </record>
  <record>
    <row><source_ip>2.2.2.2</source_ip><count>1</count>
      <policy_evaluated><disposition>reject</disposition><dkim>fail</dkim><spf>fail</spf></policy_evaluated>
    </row>
    <auth_results><dkim><result>fail</result></dkim><spf><result>fail</result></spf></auth_results>
  </record>
</feedback>`;

      const report = parseDMARCReportFromString(xml);

      expect(report.records).toHaveLength(2);
      expect(report.records[0].sourceIp).toBe("1.1.1.1");
      expect(report.records[1].sourceIp).toBe("2.2.2.2");
      expect(report.records[1].policyEvaluated.disposition).toBe("reject");
    });

    it("returns empty records array when no <record> elements", () => {
      const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <report_id>no-rec</report_id>
    <date_range><begin>0</begin><end>0</end></date_range>
  </report_metadata>
  <policy_published><domain>x.com</domain><p>none</p></policy_published>
</feedback>`;

      const report = parseDMARCReportFromString(xml);
      expect(report.records).toHaveLength(0);
    });

    it("defaults missing policy_published alignment fields to 'r'", () => {
      const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <report_id>defaults</report_id>
    <date_range><begin>0</begin><end>0</end></date_range>
  </report_metadata>
  <policy_published><domain>x.com</domain><p>none</p></policy_published>
</feedback>`;

      const report = parseDMARCReportFromString(xml);
      expect(report.adkim).toBe("r");
      expect(report.aspf).toBe("r");
      expect(report.policyPct).toBe(100);
    });

    it("throws on invalid XML structure", () => {
      expect(() => parseDMARCReportFromString("<html><body>not dmarc</body></html>")).toThrow(
        "Invalid XML structure",
      );
    });

    it("parses report without feedback wrapper (flat structure)", () => {
      const xml = `<?xml version="1.0"?>
<report_metadata>
  <org_name>microsoft.com</org_name>
  <report_id>flat-report</report_id>
  <date_range><begin>500</begin><end>600</end></date_range>
</report_metadata>
<policy_published>
  <domain>flat.com</domain>
  <p>none</p>
</policy_published>`;

      const report = parseDMARCReportFromString(xml);
      expect(report.reportId).toBe("flat-report");
      expect(report.orgName).toBe("microsoft.com");
      expect(report.domain).toBe("flat.com");
    });
  });
}
```

**Step 2: Run tests to verify they fail**

```bash
pnpm test 2>&1 | grep -E "FAIL|records|adkim|policyPct"
```

Expected: failures because `report.records`, `report.adkim`, etc. don't exist yet on the old return type.

**Step 3: Rewrite `parseDMARCReportFromString` in `src/dmarc.ts`**

Update the import at the top:

```typescript
import type {
  ParsedDMARCReport,
  DMARCRecord,
  DKIMAuthResult,
  SPFAuthResult,
  AuthResult,
  DMARCAuthResultType,
  DMARCDisposition,
  DMARCAlignment,
  DMARCPassFail,
  SourceIP,
  Domain,
  ReportId,
} from "./types";
```

Replace the entire `parseDMARCReportFromString` function (keep all the XML interface types and `parseXML`/`isXMLDMARCFeedback` helpers unchanged):

```typescript
export function parseDMARCReportFromString(xml: string): ParsedDMARCReport {
  const parsed = parseXML(xml);

  if (!isXMLDMARCFeedback(parsed)) {
    throw new Error("Invalid XML structure");
  }

  const feedback = parsed.feedback ?? parsed;
  const meta = feedback.report_metadata;
  const pub = feedback.policy_published;

  const rawRecords = feedback.record;
  const xmlRecords: XMLDMARCRecord[] = !rawRecords
    ? []
    : Array.isArray(rawRecords)
      ? rawRecords
      : [rawRecords];

  const records: DMARCRecord[] = xmlRecords.map((rec): DMARCRecord => {
    const row = rec.row;
    const identifiers = rec.identifiers;
    const authData = rec.auth_results;

    const dkimElements = authData?.dkim ?? [];
    const dkimArray: XMLAuthResult[] = Array.isArray(dkimElements) ? dkimElements : [dkimElements];

    const spfElements = authData?.spf ?? [];
    const spfArray: XMLAuthResult[] = Array.isArray(spfElements) ? spfElements : [spfElements];

    const authResults: AuthResult[] = [
      ...dkimArray.map(
        (d): DKIMAuthResult => ({
          type: "dkim",
          domain: (d.domain ?? "") as Domain,
          selector: d.selector ?? "",
          result: (typeof d.result === "string"
            ? d.result.toLowerCase()
            : "none") as DMARCAuthResultType,
        }),
      ),
      ...spfArray.map(
        (s): SPFAuthResult => ({
          type: "spf",
          domain: (s.domain ?? "") as Domain,
          result: (typeof s.result === "string"
            ? s.result.toLowerCase()
            : "none") as DMARCAuthResultType,
        }),
      ),
    ];

    const count =
      typeof row?.count === "number" ? row.count : parseInt(String(row?.count ?? "1"), 10);

    return {
      sourceIp: (row?.source_ip ?? "") as SourceIP,
      count: isNaN(count) ? 1 : count,
      policyEvaluated: {
        disposition: (row?.policy_evaluated?.disposition ?? "none") as DMARCDisposition,
        dkim: (row?.policy_evaluated?.dkim ?? "fail") as DMARCPassFail,
        spf: (row?.policy_evaluated?.spf ?? "fail") as DMARCPassFail,
      },
      headerFrom: (identifiers?.header_from ?? "") as Domain,
      envelopeFrom: (identifiers?.envelope_from ?? "") as Domain,
      envelopeTo: (identifiers?.envelope_to ?? "") as Domain,
      authResults,
    };
  });

  return {
    reportId: (meta?.report_id ?? "") as ReportId,
    orgName: meta?.org_name ?? "",
    domain: (pub?.domain ?? "") as Domain,
    beginDate: parseInt(meta?.date_range?.begin ?? "0", 10),
    endDate: parseInt(meta?.date_range?.end ?? "0", 10),
    adkim: (pub?.adkim ?? "r") as DMARCAlignment,
    aspf: (pub?.aspf ?? "r") as DMARCAlignment,
    policyP: (pub?.p ?? "none") as DMARCDisposition,
    policySp: (pub?.sp ?? "none") as DMARCDisposition,
    policyPct: parseInt(pub?.pct ?? "100", 10),
    rawXml: xml,
    records,
  };
}
```

**Step 4: Run type-check**

```bash
pnpm exec tsc --noEmit 2>&1 | grep "error TS"
```

Expected: errors only in `storage.ts` (still uses old `DMARCReport` shape). Do NOT commit yet.

---

### Task 4: Update `src/storage.ts` and `src/__tests__/storage.test.ts`

**Files:**

- Modify: `src/storage.ts`
- Modify: `src/__tests__/storage.test.ts`

**Context:** `storeReport` must write the new `dmarc_reports` columns and batch-insert into `dmarc_records`. The test file's `beforeAll` creates tables — update it for the new schema.

**Step 1: Update `src/__tests__/storage.test.ts`**

Replace the `beforeAll` to create the updated `dmarc_reports` schema and the new `dmarc_records` table. Add a new `describe("storeReport")` block.

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

import { storeReport, storeTLSReport } from "../storage";
import type {
  NormalizedTLSReport,
  ParsedDMARCReport,
  DMARCRecord,
  SourceIP,
  Domain,
  ReportId,
} from "../types";

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(`
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
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS dmarc_records (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id     TEXT NOT NULL,
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

const RECORD: DMARCRecord = {
  sourceIp: "1.2.3.4" as SourceIP,
  count: 5,
  policyEvaluated: { disposition: "none", dkim: "pass", spf: "pass" },
  headerFrom: "example.com" as Domain,
  envelopeFrom: "example.com" as Domain,
  envelopeTo: "inbox@example.com" as Domain,
  authResults: [
    { type: "dkim", domain: "example.com" as Domain, selector: "s1", result: "pass" },
    { type: "spf", domain: "example.com" as Domain, result: "pass" },
  ],
};

describe("storeReport", () => {
  it("inserts into dmarc_reports with policy fields", async () => {
    const report: ParsedDMARCReport = {
      reportId: "store-test-1" as ReportId,
      orgName: "google.com",
      domain: "example.com" as Domain,
      beginDate: 1704067200,
      endDate: 1704153599,
      adkim: "s",
      aspf: "r",
      policyP: "reject",
      policySp: "none",
      policyPct: 100,
      rawXml: "<xml/>",
      records: [RECORD],
    };

    await storeReport(report, "dmarc", env);

    const row = await env.DB.prepare("SELECT * FROM dmarc_reports WHERE report_id = ?")
      .bind("store-test-1")
      .first();

    expect(row).not.toBeNull();
    if (!row) return;
    expect(row["org_name"]).toBe("google.com");
    expect(row["adkim"]).toBe("s");
    expect(row["aspf"]).toBe("r");
    expect(row["policy_p"]).toBe("reject");
    expect(row["policy_sp"]).toBe("none");
    expect(row["policy_pct"]).toBe(100);
  });

  it("inserts dmarc_records rows for each record", async () => {
    const report: ParsedDMARCReport = {
      reportId: "store-test-2" as ReportId,
      orgName: "yahoo.com",
      domain: "example.com" as Domain,
      beginDate: 1704067200,
      endDate: 1704153599,
      adkim: "r",
      aspf: "r",
      policyP: "none",
      policySp: "none",
      policyPct: 100,
      rawXml: "<xml/>",
      records: [
        RECORD,
        {
          ...RECORD,
          sourceIp: "5.6.7.8" as SourceIP,
          count: 2,
          policyEvaluated: { disposition: "quarantine", dkim: "fail", spf: "fail" },
        },
      ],
    };

    await storeReport(report, "dmarc", env);

    const results = await env.DB.prepare(
      "SELECT * FROM dmarc_records WHERE report_id = ? ORDER BY source_ip",
    )
      .bind("store-test-2")
      .all();

    expect(results.results).toHaveLength(2);
    expect(results.results[0]["source_ip"]).toBe("1.2.3.4");
    expect(results.results[0]["dkim_result"]).toBe("pass");
    expect(results.results[0]["header_from"]).toBe("example.com");
    expect(results.results[1]["source_ip"]).toBe("5.6.7.8");
    expect(results.results[1]["dkim_result"]).toBe("fail");
    expect(results.results[1]["disposition"]).toBe("quarantine");
  });

  it("serialises auth_results as JSON", async () => {
    const report: ParsedDMARCReport = {
      reportId: "store-test-3" as ReportId,
      orgName: "test.com",
      domain: "example.com" as Domain,
      beginDate: 0,
      endDate: 0,
      adkim: "r",
      aspf: "r",
      policyP: "none",
      policySp: "none",
      policyPct: 100,
      rawXml: "<xml/>",
      records: [RECORD],
    };

    await storeReport(report, "dmarc", env);

    const row = await env.DB.prepare("SELECT auth_results FROM dmarc_records WHERE report_id = ?")
      .bind("store-test-3")
      .first();

    expect(row).not.toBeNull();
    if (!row) return;

    const parsed = JSON.parse(row["auth_results"] as string);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe("dkim");
    expect(parsed[0].selector).toBe("s1");
    expect(parsed[1].type).toBe("spf");
  });

  it("does not insert duplicate reports (ON CONFLICT DO NOTHING)", async () => {
    const report: ParsedDMARCReport = {
      reportId: "store-dedup" as ReportId,
      orgName: "dupe.com",
      domain: "example.com" as Domain,
      beginDate: 0,
      endDate: 0,
      adkim: "r",
      aspf: "r",
      policyP: "none",
      policySp: "none",
      policyPct: 100,
      rawXml: "<xml/>",
      records: [],
    };

    await storeReport(report, "dmarc", env);
    await storeReport(report, "dmarc", env);

    const results = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM dmarc_reports WHERE report_id = ?",
    )
      .bind("store-dedup")
      .first();

    expect(results?.["c"]).toBe(1);
  });
});

// --- existing TLS tests below (unchanged) ---
```

Then keep the existing `describe("storeTLSReport", ...)` block unchanged below.

**Step 2: Run tests to verify they fail**

```bash
pnpm test 2>&1 | grep -E "FAIL|storeReport|dmarc_records"
```

Expected: failures because `storeReport` still uses the old `DMARCReport` shape.

**Step 3: Rewrite `src/storage.ts`**

```typescript
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
  type: "dmarc" | "tlsrpt",
  env: Env,
): Promise<void> {
  storeInAnalytics(report, type, env);
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

async function storeRecordsInD1(
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
```

**Step 4: Run type-check and tests**

```bash
pnpm exec tsc --noEmit 2>&1 | grep "error TS"
pnpm test 2>&1 | tail -10
```

Expected: 0 type errors, all tests pass (the caller in `index.ts` at line 125–126 still compiles because `parseDMARCReportFromString` returns `ParsedDMARCReport` which is accepted by `storeReport`).

**Step 5: Run linter and formatter**

```bash
pnpm exec oxlint --type-aware 2>&1 | tail -5
pnpm exec oxfmt --check src/ 2>&1 | tail -5
```

Expected: 0 warnings, 0 errors, no format issues.

**Step 6: Commit tasks 1–4 together**

```bash
git add src/types.ts src/dmarc.ts src/storage.ts src/__tests__/storage.test.ts schema.sql
git commit -m "refactor(dmarc): per-record schema — dmarc_records table, branded types, discriminated union"
```

---

### Task 5: Add `/migrate-records` endpoint to `src/index.ts`

**Files:**

- Modify: `src/index.ts`

**Context:** The existing fetch handler at line 24–49 only handles `POST /replay`. Expand it to also handle `POST /migrate-records`. The migration re-parses stored `raw_xml` to populate `dmarc_records` for existing reports.

**Step 1: Update the fetch handler**

Replace the existing `fetch` handler (lines 24–49):

```typescript
async fetch(request: Request, env: Env): Promise<Response> {
  const { method } = request;
  const { pathname } = new URL(request.url);

  if (method !== "POST") {
    return new Response("", { status: 204 });
  }

  if (pathname === "/replay") {
    return handleReplay(env);
  }

  if (pathname === "/migrate-records") {
    return handleMigrateRecords(env);
  }

  return new Response("", { status: 204 });
},
```

Add these two functions near the bottom of the file (above the `if (import.meta.vitest)` block if present, otherwise at the end):

```typescript
async function handleReplay(env: Env): Promise<Response> {
  const results: Record<string, string> = {};
  let cursor: string | undefined;

  do {
    const list = await env.R2_BUCKET.list({ prefix: "raw-emails/", cursor });
    for (const obj of list.objects) {
      try {
        const r2obj = await env.R2_BUCKET.get(obj.key);
        if (!r2obj) continue;
        const { processed, skipped } = await processAttachments(
          new Uint8Array(await r2obj.arrayBuffer()),
          env,
        );
        results[obj.key] = `processed=${processed} skipped=${skipped}`;
      } catch (e) {
        results[obj.key] = `error: ${String(e)}`;
      }
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor !== undefined);

  return Response.json(results);
}

async function handleMigrateRecords(env: Env): Promise<Response> {
  let migrated = 0;
  let skipped = 0;
  const errors: string[] = [];

  const rows = await env.DB.prepare(
    `SELECT report_id, raw_xml FROM dmarc_reports
     WHERE raw_xml IS NOT NULL
     AND report_id NOT IN (SELECT DISTINCT report_id FROM dmarc_records)`,
  ).all();

  for (const row of rows.results) {
    const reportId = row["report_id"] as string;
    const rawXml = row["raw_xml"] as string;
    try {
      const report = parseDMARCReportFromString(rawXml);
      await storeRecordsInD1(report.records, report.reportId, env.DB);
      migrated++;
    } catch (e) {
      errors.push(`${reportId}: ${String(e)}`);
    }
  }

  return Response.json({ migrated, skipped, errors });
}
```

Note: `storeRecordsInD1` is currently a private function in `storage.ts`. Export it:

In `src/storage.ts`, change:

```typescript
async function storeRecordsInD1(
```

to:

```typescript
export async function storeRecordsInD1(
```

And add it to the import in `src/index.ts`:

```typescript
import { storeReport, storeTLSReport, storeRecordsInD1 } from "./storage";
```

**Step 2: Run type-check and tests**

```bash
pnpm exec tsc --noEmit 2>&1 | grep "error TS"
pnpm test 2>&1 | tail -5
```

Expected: 0 errors, all tests pass.

**Step 3: Lint and format**

```bash
pnpm exec oxlint --type-aware 2>&1 | tail -3
pnpm exec oxfmt --check src/ 2>&1 | tail -3
```

**Step 4: Commit**

```bash
git add src/index.ts src/storage.ts
git commit -m "feat(migrate): add POST /migrate-records endpoint to backfill dmarc_records"
```

---

### Task 6: Apply schema to remote D1 and run migration

**Context:** D1 does not support `DROP COLUMN`. The existing 7 reports have `raw_xml` stored. Apply the new columns and table to the remote DB, then call `/migrate-records` to populate `dmarc_records` from existing reports.

**Step 1: Deploy the worker**

```bash
wrangler deploy
```

Expected: deployment succeeds.

**Step 2: Add new columns to remote `dmarc_reports`**

```bash
wrangler d1 execute dmarc_reports --remote --command="ALTER TABLE dmarc_reports ADD COLUMN adkim TEXT NOT NULL DEFAULT 'r'"
wrangler d1 execute dmarc_reports --remote --command="ALTER TABLE dmarc_reports ADD COLUMN aspf TEXT NOT NULL DEFAULT 'r'"
wrangler d1 execute dmarc_reports --remote --command="ALTER TABLE dmarc_reports ADD COLUMN policy_sp TEXT"
wrangler d1 execute dmarc_reports --remote --command="ALTER TABLE dmarc_reports ADD COLUMN policy_pct INTEGER"
```

Expected: each returns success.

**Step 3: Create the `dmarc_records` table remotely**

```bash
wrangler d1 execute dmarc_reports --remote --command="
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
)"
wrangler d1 execute dmarc_reports --remote --command="CREATE INDEX IF NOT EXISTS idx_records_report_id ON dmarc_records(report_id)"
wrangler d1 execute dmarc_reports --remote --command="CREATE INDEX IF NOT EXISTS idx_records_source_ip ON dmarc_records(source_ip)"
```

**Step 4: Run the migration**

```bash
curl -X POST https://dmarc-email-worker.udmada.workers.dev/migrate-records
```

Expected: `{"migrated": 7, "skipped": 0, "errors": []}` (adjust expected count based on actual reports).

**Step 5: Verify records were written**

```bash
wrangler d1 execute dmarc_reports --remote --command="SELECT report_id, source_ip, dkim_result, spf_result, header_from FROM dmarc_records ORDER BY report_id LIMIT 20"
```

Expected: rows with source IPs and DKIM/SPF results.

**Step 6: Remove the migration endpoint**

In `src/index.ts`, remove the `if (pathname === "/migrate-records")` branch and the `handleMigrateRecords` function. Remove `storeRecordsInD1` from the import if it's no longer used in `index.ts`. Keep the export on `storeRecordsInD1` in `storage.ts` (still useful for tests).

**Step 7: Commit**

```bash
git add src/index.ts
git commit -m "chore: remove /migrate-records endpoint after successful backfill"
```
