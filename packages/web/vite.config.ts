import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const DEV_BACKEND_URL = process.env.JASOJEON_DEV_BACKEND_URL ?? "http://localhost:4000";

export default defineConfig({
  resolve: {
    alias: {
      "@jasojeon/shared/reviewerCard": fileURLToPath(new URL("../shared/src/core/reviewerCard.ts", import.meta.url))
    }
  },
  server: {
    proxy: {
      "/api": { target: DEV_BACKEND_URL, changeOrigin: false },
      "/auth": { target: DEV_BACKEND_URL, changeOrigin: false },
      "/ws": { target: DEV_BACKEND_URL, changeOrigin: false, ws: true }
    }
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"]
  }
});
