import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// P13: DATABASE_URL for tests/db comes from the local .env (development branch only).
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
