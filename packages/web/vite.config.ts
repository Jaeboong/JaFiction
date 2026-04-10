import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@jafiction/shared/reviewerCard": fileURLToPath(new URL("../shared/src/core/reviewerCard.ts", import.meta.url))
    }
  }
});
