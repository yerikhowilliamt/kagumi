import type { Prisma } from "@/generated/prisma/client";

// Admin order queries. Server only; every function takes the client, so tests pass a rolled-back transaction.
type Client = Prisma.TransactionClient;

/**
 * The status bar counts of D17 (System Design §4.9). `today` is the WIB date "YYYY-MM-DD" (jakartaToday): a
 * pre-order is open while its deadline is null or not before today, the rule of isClosed.
 */
export async function statusBarCounts(client: Client, today: string) {
  const [newOrders, openPreOrders] = await Promise.all([
    client.order.count({ where: { status: "NEW" } }),
    client.product.count({
      where: {
        isActive: true,
        type: "PRE_ORDER",
        OR: [{ orderDeadline: null }, { orderDeadline: { gte: new Date(`${today}T00:00:00Z`) } }],
      },
    }),
  ]);
  return { newOrders, openPreOrders };
}
