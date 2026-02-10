export { ReplyQueue } from "./reply-queue";
import pako from "pako";
import PostalMime from "postal-mime";

import { parseDMARCReportFromString } from "./dmarc";
import { queueReply } from "./reply";
import { storeReport, storeTLSReport } from "./storage";
import { parseTLSReport } from "./tlsrpt";
import type { Env } from "./types";

const TRUSTED_REPORTERS = new Set([
  "google.com",
  "microsoft.com",
  "yahoo.com",
  "amazon.com",
  "apple.com",
  "icloud.com",
  "proofpoint.com",
  "dmarcian.com",
  "postmarkapp.com",
  "sendgrid.net",
]);

export default {
  fetch(): Response {
    return new Response("", { status: 204 });
  },

  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const fromDomain = message.from.split("@")[1]?.toLowerCase() ?? "unknown";
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `raw-emails/${fromDomain}/${ts}.eml`;

    // Store raw email to R2 for replay before any validation
    const arrayBuffer = await new Response(message.raw).arrayBuffer();
    await env.R2_BUCKET.put(key, arrayBuffer, {
      customMetadata: { from: message.from, to: message.to },
    });

    // Rate limiting per sender domain
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
    if (dmarcMatch?.[1] === "fail") {
      console.warn(`DMARC fail from ${fromDomain}, rejecting`);
      return;
    }

    // Parse email from already-read buffer
    const rawEmail = new Uint8Array(arrayBuffer);
    const parsed = await PostalMime.parse(rawEmail);

    if (parsed.attachments.length === 0) {
      console.error("No attachments found");
      return;
    }

    // Process attachments
    for (const attachment of parsed.attachments) {
      const { type, content } = detectAndDecompress({
        content: attachment.content,
        mimeType: attachment.mimeType,
      });

      if (type === "dmarc") {
        const report = parseDMARCReportFromString(content);
        await storeReport(report, "dmarc", env);
        await queueReply(message, report.reportId, env);
      } else if (type === "tlsrpt") {
        const report = parseTLSReport(content);
        if (report !== null) {
          await storeTLSReport(report, env);
        }
      }
    }
  },
} satisfies ExportedHandler<Env>;

// Optimized: Single decompression + detection
function detectAndDecompress(attachment: { mimeType?: string; content: ArrayBuffer | string }): {
  type: "dmarc" | "tlsrpt" | "unknown";
  content: string;
} {
  let content: string;
  const raw =
    typeof attachment.content === "string"
      ? new TextEncoder().encode(attachment.content)
      : new Uint8Array(attachment.content);

  try {
    const decompressed = pako.ungzip(raw);
    content = new TextDecoder().decode(decompressed);
  } catch {
    content = new TextDecoder().decode(raw);
  }

  if (content.includes("<feedback>") || content.includes("<?xml")) {
    return { type: "dmarc", content };
  }
  if (content.includes('"organization-name"')) {
    return { type: "tlsrpt", content };
  }

  return { type: "unknown", content };
}
