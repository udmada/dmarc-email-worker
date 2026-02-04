import { DurableObject } from "cloudflare:workers";
import type { Env, ReplyMessage } from "./types";
import { sendReply } from "./reply";

interface PendingJob {
  msg: ReplyMessage;
  attempts: number;
}

const MAX_ATTEMPTS = 5;

export class ReplyQueue extends DurableObject<Env> {
  async enqueue(msg: ReplyMessage): Promise<void> {
    const key = `job:${msg.reportId}`;
    const job: PendingJob = { msg, attempts: 0 };
    await this.ctx.storage.put(key, job);

    // Schedule alarm for the earliest pending job
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || msg.sendAt < currentAlarm) {
      await this.ctx.storage.setAlarm(msg.sendAt);
    }
  }

  async alarm(): Promise<void> {
    const allEntries = await this.ctx.storage.list<PendingJob>({
      prefix: "job:",
    });
    const now = Date.now();
    let nextAlarm: number | null = null;

    for (const [key, job] of allEntries) {
      if (job.msg.sendAt > now) {
        // Not due yet — track for rescheduling
        if (nextAlarm === null || job.msg.sendAt < nextAlarm) {
          nextAlarm = job.msg.sendAt;
        }
        continue;
      }

      try {
        await sendReply(job.msg, this.env);
        await this.ctx.storage.delete(key);
      } catch (e) {
        const next = job.attempts + 1;
        if (next >= MAX_ATTEMPTS) {
          console.error(
            `Dropping reply for ${job.msg.reportId} after ${String(MAX_ATTEMPTS)} attempts: ${String(e)}`
          );
          await this.ctx.storage.delete(key);
        } else {
          // Exponential backoff: 5 min, 10 min, 20 min, 40 min
          const retryAt = now + 5 * 60 * 1000 * Math.pow(2, next - 1);
          const updated: PendingJob = {
            msg: { ...job.msg, sendAt: retryAt },
            attempts: next,
          };
          await this.ctx.storage.put(key, updated);
          if (nextAlarm === null || retryAt < nextAlarm) {
            nextAlarm = retryAt;
          }
        }
      }
    }

    if (nextAlarm !== null) {
      await this.ctx.storage.setAlarm(nextAlarm);
    }
  }
}
