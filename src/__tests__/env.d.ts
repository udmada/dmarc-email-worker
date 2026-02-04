import type { Env } from "../types";
import type { ReplyQueue } from "../reply-queue";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    REPLY_QUEUE: DurableObjectNamespace<ReplyQueue>;
    TEST_MIGRATIONS: D1Migration[];
  }
}
