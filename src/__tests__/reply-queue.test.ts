import { env, runInDurableObject } from "cloudflare:test";
import { describe, it, expect } from "vitest";

import type { ReplyQueue } from "../reply-queue";
import type { ReplyMessage } from "../types";

function makeMsg(overrides: Partial<ReplyMessage> = {}): ReplyMessage {
  return {
    messageId: "<test@example.com>",
    replyTo: "sender@example.com",
    reportId: overrides.reportId ?? "rpt-1",
    subject: "DMARC Report",
    sendAt: overrides.sendAt ?? Date.now() - 1000, // due by default
    ...overrides,
  };
}

let stubCounter = 0;
function getStub(): DurableObjectStub<ReplyQueue> {
  // Each test gets a fresh DO instance to avoid shared state
  const id = env.REPLY_QUEUE.idFromName(`test-${String(++stubCounter)}`);
  return env.REPLY_QUEUE.get(id);
}

describe("ReplyQueue", () => {
  it("enqueue stores a job in DO storage", async () => {
    const stub = getStub();
    const msg = makeMsg({ reportId: "store-test" });

    await stub.enqueue(msg);

    const job = await runInDurableObject(stub, async (_instance, state) => {
      return await state.storage.get<{ msg: ReplyMessage; attempts: number }>("job:store-test");
    });

    expect(job).not.toBeUndefined();
    expect(job?.msg.reportId).toBe("store-test");
    expect(job?.attempts).toBe(0);
  });

  it("enqueue sets an alarm", async () => {
    const stub = getStub();
    const sendAt = Date.now() + 60_000;
    await stub.enqueue(makeMsg({ reportId: "alarm-set", sendAt }));

    const alarm = await runInDurableObject(stub, async (_instance, state) => {
      return await state.storage.getAlarm();
    });

    expect(alarm).toBe(sendAt);
  });

  it("enqueue moves alarm earlier when new job is sooner", async () => {
    const stub = getStub();
    const later = Date.now() + 120_000;
    const sooner = Date.now() + 30_000;

    await stub.enqueue(makeMsg({ reportId: "later", sendAt: later }));
    await stub.enqueue(makeMsg({ reportId: "sooner", sendAt: sooner }));

    const alarm = await runInDurableObject(stub, async (_instance, state) => {
      return await state.storage.getAlarm();
    });

    expect(alarm).toBe(sooner);
  });

  it("alarm deletes due jobs after processing", async () => {
    const stub = getStub();
    // sendReply is a no-op when EMAIL is undefined, so alarm "succeeds"
    await stub.enqueue(makeMsg({ reportId: "due-job" }));

    const remaining = await runInDurableObject(stub, async (instance, state) => {
      await instance.alarm();
      const entries = await state.storage.list({ prefix: "job:" });
      return entries.size;
    });

    expect(remaining).toBe(0);
  });

  it("alarm skips future jobs and reschedules", async () => {
    const stub = getStub();
    const futureTime = Date.now() + 999_999_999;
    await stub.enqueue(makeMsg({ reportId: "future-job", sendAt: futureTime }));

    const result = await runInDurableObject(stub, async (instance, state) => {
      await instance.alarm();
      const entries = await state.storage.list({ prefix: "job:" });
      const alarm = await state.storage.getAlarm();
      return { jobCount: entries.size, alarm };
    });

    expect(result.jobCount).toBe(1);
    expect(result.alarm).toBe(futureTime);
  });

  it("alarm processes only due jobs in a mixed batch", async () => {
    const stub = getStub();
    const futureTime = Date.now() + 999_999_999;

    await stub.enqueue(makeMsg({ reportId: "due-1" }));
    await stub.enqueue(makeMsg({ reportId: "due-2" }));
    await stub.enqueue(makeMsg({ reportId: "not-yet", sendAt: futureTime }));

    const keys = await runInDurableObject(stub, async (instance, state) => {
      await instance.alarm();
      const entries = await state.storage.list({ prefix: "job:" });
      return [...entries.keys()];
    });

    expect(keys).toEqual(["job:not-yet"]);
  });
});
