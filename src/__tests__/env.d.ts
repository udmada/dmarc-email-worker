import type { Env, ReplyMessage } from "../types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    EMAIL_QUEUE: Queue<ReplyMessage>;
    TEST_MIGRATIONS: D1Migration[];
  }
}
