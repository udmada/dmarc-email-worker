# DMARC Records Schema Design

**Date:** 2026-03-19
**Goal:** Expand D1 schema to store per-record DMARC data, enabling a future UI that shows per-sender/per-IP breakdowns, authentication details, and identifiers.

**Approach:** Data layer only (worker). Astro UI is a separate future plan.

---

## Schema

### `dmarc_reports` — remove aggregates, add policy fields

Remove: `dkim_pass`, `dkim_fail`, `dkim_temperror`, `spf_pass`, `spf_fail`, `spf_temperror`

Add: `adkim TEXT`, `aspf TEXT`, `policy_sp TEXT`, `policy_pct INTEGER`

Note: D1 does not support `DROP COLUMN` — the new `schema.sql` reflects the final desired shape for fresh deploys. Existing deployments keep the old columns (they become unused).

### `dmarc_records` — new table, one row per `<record>` element

```sql
CREATE TABLE dmarc_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id     TEXT NOT NULL REFERENCES dmarc_reports(report_id),
  source_ip     TEXT NOT NULL,
  count         INTEGER NOT NULL DEFAULT 1,
  disposition   TEXT,        -- none | quarantine | reject
  dkim_result   TEXT,        -- pass | fail (policy_evaluated)
  spf_result    TEXT,        -- pass | fail (policy_evaluated)
  header_from   TEXT,
  envelope_from TEXT,
  envelope_to   TEXT,
  auth_results  TEXT,        -- JSON: [{type,domain,selector?,result}]
  created_at    INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX idx_records_report_id ON dmarc_records(report_id);
CREATE INDEX idx_records_source_ip ON dmarc_records(source_ip);
```

---

## Types (`src/types.ts`)

### Branded primitives

```typescript
type Brand<T, B extends string> = T & { readonly _brand: B };
export type SourceIP = Brand<string, "SourceIP">;
export type Domain = Brand<string, "Domain">;
export type ReportId = Brand<string, "ReportId">;
```

### Const-derived union types

```typescript
const DMARC_ALIGNMENT = { r: "r", s: "s" } as const;
export type DMARCAlignment = keyof typeof DMARC_ALIGNMENT;

const DMARC_DISPOSITION = { none: "none", quarantine: "quarantine", reject: "reject" } as const;
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

export type DMARCPassFail = Extract<DMARCAuthResultType, "pass" | "fail">;
```

### AuthResult discriminated union

```typescript
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
export type AuthResultForType<T extends AuthResult["type"]> = Extract<AuthResult, { type: T }>;

export function isDKIMAuthResult(r: AuthResult): r is AuthResultForType<"dkim"> {
  return r.type === "dkim";
}
export function isSPFAuthResult(r: AuthResult): r is AuthResultForType<"spf"> {
  return r.type === "spf";
}
```

### Core interfaces

```typescript
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

export type ParsedDMARCReport = DMARCReport<readonly DMARCRecord[]>;
export type StoredDMARCReport = DMARCReport<readonly []>;
```

---

## Parser (`src/dmarc.ts`)

- Return type changes from `DMARCReport` → `ParsedDMARCReport`
- Remove aggregate counting loop
- Extract `adkim`, `aspf`, `sp`, `pct` from `policy_published`
- For each `<record>`, build a `DMARCRecord`:
  - `policyEvaluated` from `row.policy_evaluated` (disposition, dkim, spf)
  - identifiers from `record.identifiers` (header_from, envelope_from, envelope_to)
  - `authResults` as `readonly AuthResult[]` — DKIM entries become `DKIMAuthResult`, SPF entries become `SPFAuthResult`
- Branded casts at parse boundary: `source_ip as SourceIP`, `domain as Domain`, `report_id as ReportId`

---

## Storage (`src/storage.ts`)

- `storeReport(report: ParsedDMARCReport, type, env)` — updated signature
- `storeInD1`: inserts `dmarc_reports` without aggregate columns, with new policy fields
- New `storeRecordsInD1`: `db.batch()` of one INSERT per `DMARCRecord` into `dmarc_records`; `auth_results` serialised as `JSON.stringify(record.authResults)`
- `storeInAnalytics`: writes one data point per report — blobs: `[orgName, domain, reportId, type]`; doubles dropped (aggregates gone)
- `storeInPostgres`: updated to match new `dmarc_reports` columns

---

## Migration (`src/index.ts`)

One-off `POST /migrate-records` endpoint:

1. Query reports with no corresponding records:
   ```sql
   SELECT report_id, raw_xml FROM dmarc_reports
   WHERE raw_xml IS NOT NULL
   AND report_id NOT IN (SELECT DISTINCT report_id FROM dmarc_records)
   ```
2. Re-parse each `raw_xml` via `parseDMARCReportFromString`
3. Call `storeRecordsInD1` for each
4. Return `{ migrated: N, skipped: N, errors: string[] }`
5. Remove endpoint after successful run

Idempotent — safe to run multiple times.

---

## Out of scope

- Astro UI project setup
- API endpoints for the frontend
- Analytics Engine per-record schema (upstream format)
- TLS-RPT schema changes
