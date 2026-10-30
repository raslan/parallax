import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // theme tests read the stylesheets as raw text
    css: { include: [/src\/themes\/.*\.css/] },
    setupFiles: ["./src/test-setup.ts"],
  },
});
