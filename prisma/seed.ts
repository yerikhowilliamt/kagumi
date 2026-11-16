// Development seed (P15). Run only with `npx prisma db seed` against the development branch.
// Inserts the menu only when `products` is empty, so running it again changes nothing.
import type { Prisma } from "../src/generated/prisma/client.ts";

const products = [
  { name: "Bolu Gulung", category: "Kue", type: "PRE_ORDER", description: "Lembut dengan filling nanas, strawberry, atau blueberry." },
  { name: "Fudgy Brownies", category: "Brownies", type: "PRE_ORDER", description: "Padat, nyoklat, dan moist. Ukuran 20×10 cm." },
  { name: "Brownies Custom", category: "Brownies", type: "PRE_ORDER", description: "Tulisan dan dekorasi sesuai request, cocok untuk kado." },
  { name: "Soft Cookies", category: "Cookies", type: "READY_STOCK", description: "Tebal, renyah di luar dan lembut di dalam." },
  { name: "Buko Mangga", category: "Dessert", type: "READY_STOCK", description: "Dessert mangga segar yang creamy dan dingin." },
  { name: "Donut", category: "Donut", type: "READY_STOCK", description: "" },
  {
    name: "Hampers Natal",
    category: "Hampers",
    type: "PRE_ORDER",
    description: "Termasuk box, paper bag, kartu & hang tag edisi Natal.",
    price: 35000,
    orderDeadline: new Date("2026-12-10"),
  },
] as const;

/**
 * Throws unless DATABASE_URL points at the development branch named in DEV_DATABASE_HOST (direct host).
 * Guards the seed and tests/db against a production URL pasted into .env (milestone plan R2).
 */
export function assertDevelopmentDatabase(env: Record<string, string | undefined> = process.env) {
  const host = env.DATABASE_URL ? new URL(env.DATABASE_URL).hostname.replace("-pooler.", ".") : undefined;
  if (!env.DEV_DATABASE_HOST || host !== env.DEV_DATABASE_HOST) {
    throw new Error("DATABASE_URL is not the development branch named in DEV_DATABASE_HOST; refusing to run");
  }
}

/** Inserts the P15 menu when `products` is empty; returns the number of rows inserted. */
export async function seedProducts(client: Prisma.TransactionClient) {
  if ((await client.product.count()) > 0) return 0;
  const { count } = await client.product.createMany({
    data: products.map((p, i) => ({ ...p, sortOrder: i + 1 })),
  });
  return count;
}

if (import.meta.main) {
  try {
    process.loadEnvFile();
  } catch {}
  assertDevelopmentDatabase();
  // Dynamic import: db.ts reads DATABASE_URL on load, so .env must be loaded first.
  const { db } = await import("../src/lib/db.ts");
  try {
    const inserted = await seedProducts(db);
    console.log(inserted ? `inserted ${inserted} products` : `products already has ${await db.product.count()} rows; nothing inserted`);
  } finally {
    await db.$disconnect();
  }
}
