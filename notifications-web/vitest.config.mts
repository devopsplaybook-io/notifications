import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      reporter: ["text", "json", "lcov"],
      include: ["stores/**/*.ts"],
      exclude: ["tests/**"],
    },
  },
});
