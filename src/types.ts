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

export interface DMARCReport {
  reportId: string;
  orgName: string;
  domain: string;
  beginDate: number;
  endDate: number;
  dkimPass: number;
  dkimFail: number;
  dkimTemperror: number;
  spfPass: number;
  spfFail: number;
  spfTemperror: number;
  policyP: string;
  rawXml: string;
}

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

export type NormalizedTLSReport = Omit<TLSReport, "policies"> & { policies?: RFCPolicy[] };

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
