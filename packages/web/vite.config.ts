import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@jasojeon/shared/reviewerCard": fileURLToPath(new URL("../shared/src/core/reviewerCard.ts", import.meta.url))
    }
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"]
  }
});
