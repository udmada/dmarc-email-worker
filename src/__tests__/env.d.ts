import type { ReplyQueue } from "../reply-queue";
import type { Env } from "../types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    REPLY_QUEUE: DurableObjectNamespace<ReplyQueue>;
    TEST_MIGRATIONS: D1Migration[];
  }
}
