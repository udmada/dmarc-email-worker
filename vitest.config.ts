import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } })],
  resolve: {
    alias: {
      mimetext: "mimetext/browser",
    },
  },
  test: {
    includeSource: ["src/**/*.ts"],
  },
});
