import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  resolve: {
    alias: {
      mimetext: "mimetext/browser",
    },
  },
  test: {
    includeSource: ["src/**/*.ts"],
    poolOptions: {
      workers: {
        // Disabled because DO alarms conflict with isolated storage teardown.
        // See: https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#isolated-storage
        isolatedStorage: false,
        miniflare: {
          durableObjects: {
            REPLY_QUEUE: "ReplyQueue",
          },
        },
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
