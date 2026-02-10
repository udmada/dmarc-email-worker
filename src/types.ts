import type { ReplyQueue } from "./reply-queue";

export interface Env {
  ANALYTICS: AnalyticsEngineDataset;
  DB: D1Database;
  HYPERDRIVE?: Hyperdrive;
  EMAIL?: SendEmail;
  REPLY_QUEUE?: DurableObjectNamespace<ReplyQueue>;
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
  sendAt: number;
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
export interface TLSReport {
  "organization-name": string;
  "date-range": {
    "start-datetime": string;
    "end-datetime": string;
  };
  "contact-info": string;
  "report-id": string;
  "policies"?: Array<{
    "policy-type": "sts" | "dane" | "dane-only" | "no-policy-found";
    "policy-domain": string;
    "summary": {
      "total-successful-session-count": number;
      "total-failure-session-count": number;
    };
    "failure-details"?: Array<{
      "result-type": string;
      "sending-mta-ip": string;
      "receiving-mx-hostname": string;
      "failed-session-count": number;
    }>;
  }>;
}
