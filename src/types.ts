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

// Const maps used only for type derivation (keyof) — not used at runtime
const DMARC_ALIGNMENT = { r: "r", s: "s" } as const;
export type DMARCAlignment = keyof typeof DMARC_ALIGNMENT;

const DMARC_DISPOSITION = {
  none: "none",
  quarantine: "quarantine",
  reject: "reject",
} as const;
export type DMARCDisposition = keyof typeof DMARC_DISPOSITION;

export const DMARC_AUTH_RESULT_TYPE = {
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
export type ParsedDMARCReport = DMARCReport;
// Future use: type for a report read back from D1 where records are loaded separately
export type StoredDMARCReport = DMARCReport<readonly []>;

// RFC 8460 TLS-RPT (kebab-case per spec)

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
