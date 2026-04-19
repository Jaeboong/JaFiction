import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const DEV_BACKEND_URL = process.env.JASOJEON_DEV_BACKEND_URL ?? "http://localhost:4000";

// Vite 5.x 의 server.allowedHosts 기본 차단 대응.
// 자소전.shop (dev) / 자소전.com (prod 예정) punycode 허용 + env override.
const EXTRA_ALLOWED_HOSTS = (process.env.JASOJEON_VITE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOWED_HOSTS = [
  "xn--9l4b13i8j.shop",
  "xn--9l4b13i8j.com",
  ...EXTRA_ALLOWED_HOSTS
];

export default defineConfig({
  resolve: {
    alias: {
      "@jasojeon/shared/reviewerCard": fileURLToPath(new URL("../shared/src/core/reviewerCard.ts", import.meta.url))
    }
  },
  server: {
    allowedHosts: ALLOWED_HOSTS,
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
