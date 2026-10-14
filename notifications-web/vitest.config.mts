import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "~~": fileURLToPath(new URL(".", import.meta.url)),
      "@@": fileURLToPath(new URL(".", import.meta.url)),
      "~": fileURLToPath(new URL(".", import.meta.url)),
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    coverage: {
      reporter: ["text", "json", "lcov"],
      include: ["stores/**/*.ts", "services/**/*.ts"],
      exclude: ["tests/**"],
    },
  },
});
