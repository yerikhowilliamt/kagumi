import { defineConfig } from "prisma/config";

// P13: local .env only; Vercel provides env vars and has no .env file.
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.ts",
  },
  // Direct (unpooled) URL for the CLI. Read without env() so `prisma generate` in postinstall works when it is unset.
  datasource: { url: process.env.DIRECT_URL ?? "" },
});
