import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

import type { Env, ReplyMessage } from "./types";

export async function queueReply(
  message: ForwardableEmailMessage,
  reportId: string,
  env: Env,
): Promise<void> {
  if (env.REPLY_QUEUE === undefined) {
    return;
  }

  const msgId = message.headers.get("Message-ID");
  if (msgId === null) {
    return;
  }

  await env.REPLY_QUEUE.send(
    {
      messageId: msgId,
      replyTo: message.from,
      reportId: reportId,
      subject: message.headers.get("Subject") ?? "DMARC Report",
    },
    { delaySeconds: 3600 },
  );
}

export async function sendReply(msg: ReplyMessage, env: Env): Promise<void> {
  if (env.EMAIL === undefined) {
    return;
  }

  const mime = createMimeMessage();
  mime.setHeader("In-Reply-To", msg.messageId);
  mime.setHeader("References", msg.messageId);
  mime.setHeader("Message-ID", `<${crypto.randomUUID()}@${env.SENDER_DOMAIN}>`);
  mime.setSender(env.SENDER_EMAIL);
  mime.setRecipient(msg.replyTo);
  mime.setSubject(`Re: ${msg.subject} - Processed`);
  mime.addMessage({
    contentType: "text/plain",
    data: `Your report ${msg.reportId} has been received and processed.\n\nView: https://${env.SENDER_DOMAIN}/reports/${msg.reportId}`,
  });

  const email = new EmailMessage(env.SENDER_EMAIL, msg.replyTo, mime.asRaw());

  await env.EMAIL.send(email);
}
