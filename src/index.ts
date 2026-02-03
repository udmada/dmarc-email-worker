import { EmailMessage } from "cloudflare:email";
import PostalMime from "postal-mime";
import { XMLParser } from "fast-xml-parser";
import pako from "pako";
import { createMimeMessage } from "mimetext";
import postgres from "postgres";

interface XMLDMARCFeedback {
  feedback?: {
    report_metadata?: {
      report_id?: string;
      org_name?: string;
      date_range?: {
        begin?: string;
        end?: string;
      };
    };
    policy_published?: {
      domain?: string;
      p?: string;
    };
    record?: XMLDMARCRecord | XMLDMARCRecord[];
  };
  report_metadata?: {
    report_id?: string;
    org_name?: string;
    date_range?: {
      begin?: string;
      end?: string;
    };
  };
  policy_published?: {
    domain?: string;
    p?: string;
  };
  record?: XMLDMARCRecord | XMLDMARCRecord[];
}

interface XMLDMARCRecord {
  auth_results?: {
    dkim?: XMLAuthResult | XMLAuthResult[];
    spf?: XMLAuthResult | XMLAuthResult[];
  };
}

interface XMLAuthResult {
  result?: string;
}

export interface Env {
  ANALYTICS: AnalyticsEngineDataset;
  DB: D1Database;
  HYPERDRIVE?: Hyperdrive;
  EMAIL: SendEmail;
  REPLY_QUEUE: Queue<ReplyMessage>;
  RATE_LIMIT: RateLimit;
}

interface ReplyMessage {
  messageId: string;
  replyTo: string;
  reportId: string;
  subject: string;
  sendAt: number;
}

interface DMARCReport {
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
interface TLSReport {
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

const TRUSTED_REPORTERS = new Set([
  "google.com",
  "microsoft.com",
  "yahoo.com",
  "amazon.com",
  "proofpoint.com",
  "dmarcian.com",
  "postmarkapp.com",
  "sendgrid.net",
]);

// Hyperdrive connection singleton
let hyperdriveClient: ReturnType<typeof postgres> | null = null;

function getPostgresClient(env: Env): ReturnType<typeof postgres> | null {
  if (!hyperdriveClient && env.HYPERDRIVE) {
    hyperdriveClient = postgres(env.HYPERDRIVE.connectionString);
  }
  return hyperdriveClient;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    // Rate limiting per sender domain
    const fromDomain = message.from.split("@")[1]?.toLowerCase() || "unknown";
    const rateLimit = await env.RATE_LIMIT.limit({
      key: `email:${fromDomain}`,
    });
    if (!rateLimit.success) {
      console.warn(`Rate limit exceeded for ${fromDomain}`);
      return;
    }

    // Security: Whitelist trusted reporters
    if (!TRUSTED_REPORTERS.has(fromDomain)) {
      console.warn(`Untrusted reporter: ${fromDomain}`);
      return;
    }

    // DMARC validation
    const authResults = message.headers.get("Authentication-Results") ?? "";
    const dmarcMatch = authResults.match(/dmarc=(\w+)/);
    if (dmarcMatch?.[1] !== "pass") {
      console.warn(`DMARC ${dmarcMatch?.[1] ?? 'none'} from ${fromDomain}, rejecting`);
      return;
    }

    // Parse email - message.raw is a ReadableStream
    const arrayBuffer = await new Response(message.raw).arrayBuffer();
    const rawEmail = new Uint8Array(arrayBuffer);
    const parser = new PostalMime();
    const parsed = await parser.parse(rawEmail.buffer) as {
      attachments?: Array<{
        content?: Uint8Array | ArrayBuffer;
        mimeType?: string;
      }>;
    };

    if (!parsed.attachments || parsed.attachments.length === 0) {
      console.error("No attachments found");
      return;
    }

    // Process attachments
    for (const attachment of parsed.attachments) {
      if (!attachment.content) continue;

      // Decompress once and detect type
      const { type, content } = detectAndDecompress({
        content: attachment.content,
        mimeType: attachment.mimeType,
      });

      if (type === "dmarc") {
        const report = parseDMARCReportFromString(content);
        await storeReport(report, "dmarc", env);
        await queueReply(message, report.reportId, env);
      } else if (type === "tlsrpt") {
        const report = JSON.parse(content) as TLSReport;
        await storeTLSReport(report, env);
      }
    }
  },

  async queue(batch: MessageBatch<ReplyMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await sendReply(msg.body, env);
        msg.ack();
      } catch (e) {
        console.error(`Reply failed: ${String(e)}`);
        msg.retry({ delaySeconds: 300 });
      }
    }
  },
};

// Optimized: Single decompression + detection
function detectAndDecompress(attachment: {
  mimeType?: string;
  content: Uint8Array | ArrayBuffer;
}): { type: "dmarc" | "tlsrpt" | "unknown"; content: string } {
  let content: string;
  const compressed = new Uint8Array(attachment.content);

  try {
    const decompressed = pako.ungzip(compressed);
    content = new TextDecoder().decode(decompressed);
  } catch {
    content = new TextDecoder().decode(compressed);
  }

  if (content.includes("<feedback>") || content.includes("<?xml")) {
    return { type: "dmarc", content };
  }
  if (content.includes('"organization-name"')) {
    return { type: "tlsrpt", content };
  }

  return { type: "unknown", content };
}

// Parse DMARC from pre-decompressed string
function parseDMARCReportFromString(xml: string): DMARCReport {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  });

  const doc = parser.parse(xml) as XMLDMARCFeedback;
  const feedback = doc.feedback ?? doc;

  const reportMetadata = feedback.report_metadata;
  const policyPublished = feedback.policy_published;

  const reportId = reportMetadata?.report_id ?? "";
  const orgName = reportMetadata?.org_name ?? "";
  const domain = policyPublished?.domain ?? "";
  const beginDate = parseInt(reportMetadata?.date_range?.begin ?? "0");
  const endDate = parseInt(reportMetadata?.date_range?.end ?? "0");
  const policyP = policyPublished?.p ?? "none";

  let dkimPass = 0,
    dkimFail = 0,
    dkimTemperror = 0;
  let spfPass = 0,
    spfFail = 0,
    spfTemperror = 0;

  const records = feedback.record;
  const recordsArray: XMLDMARCRecord[] =
    !records ? []
    : Array.isArray(records) ? records
    : [records];

  for (const record of recordsArray) {
    const authResults = record.auth_results;
    if (!authResults) continue;

    // DKIM results
    const dkimElements = authResults.dkim ?? [];
    const dkimArray: XMLAuthResult[] = Array.isArray(dkimElements) ? dkimElements : [dkimElements];

    for (const dkim of dkimArray) {
      const dkimResult = dkim.result;
      const result = typeof dkimResult === "string" ? dkimResult.toLowerCase() : "";
      if (result === "pass") dkimPass++;
      else if (result === "fail") dkimFail++;
      else if (result === "temperror") dkimTemperror++;
    }

    // SPF results
    const spfElements = authResults.spf ?? [];
    const spfArray: XMLAuthResult[] = Array.isArray(spfElements) ? spfElements : [spfElements];

    for (const spf of spfArray) {
      const spfResult = spf.result;
      const result = typeof spfResult === "string" ? spfResult.toLowerCase() : "";
      if (result === "pass") spfPass++;
      else if (result === "fail") spfFail++;
      else if (result === "temperror") spfTemperror++;
    }
  }

  return {
    reportId,
    orgName,
    domain,
    beginDate,
    endDate,
    dkimPass,
    dkimFail,
    dkimTemperror,
    spfPass,
    spfFail,
    spfTemperror,
    policyP,
    rawXml: xml,
  };
}

// Store TLS-RPT with null safety
async function storeTLSReport(report: TLSReport, env: Env): Promise<void> {
  // Null safety: default to empty array if policies undefined
  const policies = report.policies || [];

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
          JSON.stringify(policy["failure-details"] || []),
          new Date(report["date-range"]["start-datetime"]).getTime() / 1000,
          new Date(report["date-range"]["end-datetime"]).getTime() / 1000
        )
        .run();
    } catch (e) {
      console.error("TLS-RPT insert failed:", e);
    }
  }
}

async function queueReply(
  message: ForwardableEmailMessage,
  reportId: string,
  env: Env
): Promise<void> {
  const msgId = message.headers.get("Message-ID");
  if (msgId === null) return;

  await env.REPLY_QUEUE.send(
    {
      messageId: msgId,
      replyTo: message.from,
      reportId: reportId,
      subject: message.headers.get("Subject") ?? "DMARC Report",
      sendAt: Date.now() + 60 * 60 * 1000,
    },
    { delaySeconds: 3600 }
  );
}

async function sendReply(msg: ReplyMessage, env: Env): Promise<void> {
  const mime = createMimeMessage();
  mime.setHeader("In-Reply-To", msg.messageId);
  mime.setHeader("References", msg.messageId);
  mime.setHeader("Message-ID", `<${crypto.randomUUID()}@yourdomain.com>`);
  mime.setSender("reports@yourdomain.com");
  mime.setRecipient(msg.replyTo);
  mime.setSubject(`Re: ${msg.subject} - Processed`);
  mime.addMessage({
    contentType: "text/plain",
    data: `Your report ${msg.reportId} has been received and processed.\n\nView: https://yourdomain.com/reports/${msg.reportId}`,
  });

  const email = new EmailMessage(
    "reports@yourdomain.com",
    msg.replyTo,
    mime.asRaw()
  );

  await env.EMAIL.send(email);
}

// Storage implementations
async function storeReport(
  report: DMARCReport,
  type: "dmarc" | "tlsrpt",
  env: Env
): Promise<void> {
  storeInAnalytics(report, type, env);
  await Promise.allSettled([
    storeInD1(report, env.DB),
    env.HYPERDRIVE !== undefined ? storeInPostgres(report, env) : Promise.resolve(),
  ]);
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
  if (!client) return;

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
