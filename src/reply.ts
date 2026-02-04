import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";
import type { Env, ReplyMessage } from "./types";

export async function queueReply(
  message: ForwardableEmailMessage,
  reportId: string,
  env: Env
): Promise<void> {
  if (env.REPLY_QUEUE === undefined) {
    return;
  }

  const msgId = message.headers.get("Message-ID");
  if (msgId === null) {
    return;
  }

  const id = env.REPLY_QUEUE.idFromName("default");
  const stub = env.REPLY_QUEUE.get(id);
  await stub.enqueue({
    messageId: msgId,
    replyTo: message.from,
    reportId: reportId,
    subject: message.headers.get("Subject") ?? "DMARC Report",
    sendAt: Date.now() + 60 * 60 * 1000,
  });
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
