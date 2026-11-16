// Development seed (P15). Run only with `npx prisma db seed` against the development branch.
// Inserts the menu only when `products` is empty, so running it again changes nothing.
try {
  process.loadEnvFile();
} catch {}

// Dynamic import: db.ts reads DATABASE_URL on load, so .env must be loaded first.
const { db } = await import("../src/lib/db.ts");

export {};

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

try {
  const existing = await db.product.count();
  if (existing > 0) {
    console.log(`products already has ${existing} rows; nothing inserted`);
  } else {
    const { count } = await db.product.createMany({
      data: products.map((p, i) => ({ ...p, sortOrder: i + 1 })),
    });
    console.log(`inserted ${count} products`);
  }
} finally {
  await db.$disconnect();
}
