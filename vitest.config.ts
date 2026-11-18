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
    // D19: one file at a time. tests/db/checkout.test.ts consumes orders_id_seq (ROLLBACK does not undo
    // nextval()), and tests/db/schema.test.ts asserts the sequence did not move during its own file.
    fileParallelism: false,
  },
});
