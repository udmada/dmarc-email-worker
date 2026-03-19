import { unzipSync, strFromU8 } from "fflate";
import PostalMime from "postal-mime";

import { parseDMARCReportFromString } from "./dmarc";
import { queueReply, sendReply } from "./reply";
import { storeReport, storeTLSReport } from "./storage";
import { parseTLSReport } from "./tlsrpt";
import type { Env, ReplyMessage } from "./types";

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
  async fetch(request: Request, env: Env): Promise<Response> {
    const { method } = request;
    const { pathname } = new URL(request.url);

    if (method !== "POST") {
      return new Response("", { status: 204 });
    }

    if (pathname === "/replay") {
      return handleReplay(env);
    }

    return new Response("", { status: 204 });
  },

  async queue(batch: MessageBatch<ReplyMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await sendReply(msg.body, env);
        msg.ack();
      } catch (e) {
        console.error(`Failed to send reply for ${msg.body.reportId}: ${String(e)}`);
        msg.retry();
      }
    }
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

    // Security: Whitelist trusted reporters (match exact domain or subdomains)
    const isTrusted = [...TRUSTED_REPORTERS].some(
      (trusted) => fromDomain === trusted || fromDomain.endsWith(`.${trusted}`),
    );
    if (!isTrusted) {
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

    const { processed } = await processAttachments(new Uint8Array(arrayBuffer), env, message);
    if (processed === 0) {
      console.error("No reports found in attachments");
    }
  },
} satisfies ExportedHandler<Env, ReplyMessage>;

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

async function processAttachments(
  rawEmail: Uint8Array,
  env: Env,
  message?: ForwardableEmailMessage,
): Promise<{ processed: number; skipped: number }> {
  const parsed = await PostalMime.parse(rawEmail);
  let processed = 0;
  let skipped = 0;

  for (const attachment of parsed.attachments) {
    const { type, content } = await detectAndDecompress({
      content: attachment.content,
      mimeType: attachment.mimeType,
    });

    if (type === "dmarc") {
      const report = parseDMARCReportFromString(content);
      await storeReport(report, "dmarc", env);
      if (message) await queueReply(message, report.reportId, env);
      processed++;
    } else if (type === "tlsrpt") {
      const report = parseTLSReport(content);
      if (report !== null) {
        await storeTLSReport(report, env);
        processed++;
      } else {
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  return { processed, skipped };
}

// Single decompression + detection — handles both gzip (.xml.gz) and zip (.xml.zip)
async function detectAndDecompress(attachment: {
  mimeType?: string;
  content: ArrayBuffer | Uint8Array | string;
}): Promise<{ type: "dmarc" | "tlsrpt" | "unknown"; content: string }> {
  const raw =
    typeof attachment.content === "string"
      ? new TextEncoder().encode(attachment.content)
      : new Uint8Array(attachment.content);

  let content: string;

  // ZIP magic bytes: PK (0x50 0x4B)
  if (raw[0] === 0x50 && raw[1] === 0x4b) {
    try {
      const entries = Object.values(unzipSync(raw));
      content = entries.length > 0 ? strFromU8(entries[0]) : "";
    } catch {
      content = "";
    }
  } else {
    try {
      const body = new Response(raw).body;
      if (!body) throw new Error("no body");
      content = await new Response(body.pipeThrough(new DecompressionStream("gzip"))).text();
    } catch {
      content = new TextDecoder().decode(raw);
    }
  }

  if (content.includes("<feedback>") || content.includes("<?xml")) {
    return { type: "dmarc", content };
  }
  if (content.includes('"organization-name"')) {
    return { type: "tlsrpt", content };
  }

  return { type: "unknown", content };
}
