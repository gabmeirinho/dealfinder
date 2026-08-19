import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@dealfinder/domain": fileURLToPath(
        new URL("./packages/domain/src/index.ts", import.meta.url)
      )
    }
  },
  test: {
    include: [
      "apps/**/src/**/*.test.{ts,tsx}",
      "packages/**/src/**/*.test.{ts,tsx}"
    ],
    exclude: ["**/node_modules/**", "**/dist/**"]
  }
});
