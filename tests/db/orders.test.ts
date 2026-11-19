// Admin order queries against the development branch (task M2.3 K3), written from the M2 plan D17 and
// System Design §4.9. Every test runs in a transaction that is always rolled back, with a fixed `now` (W5).
// Orders get explicit ids, because ROLLBACK does not undo nextval(); the last test checks orders_id_seq did not move.
import { beforeAll, describe, expect, it } from "vitest";
import { assertDevelopmentDatabase } from "../../prisma/seed.ts";
import { jakartaToday } from "@/lib/order";
import { statusBarCounts } from "@/lib/orders";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set: tests/db needs the development branch in .env");
}
assertDevelopmentDatabase();

const { db } = await import("@/lib/db");

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
const ROLLBACK = new Error("rollback");

/** Runs fn in a transaction that is always rolled back. */
async function rolledBack(fn: (tx: Tx) => Promise<void>) {
  await expect(
    db.$transaction(
      async (tx) => {
        await fn(tx);
        throw ROLLBACK;
      },
      // maxWait: opening a Neon connection can take longer than Prisma's 2 s default (P2028, ERR-003).
      { maxWait: 10_000, timeout: 30_000 },
    ),
  ).rejects.toBe(ROLLBACK);
}

// 00:30 WIB on 20 November while UTC is still 19 November: "today" must be the WIB date.
const NOW = new Date("2026-11-19T17:30:00Z");
const TODAY = jakartaToday(NOW);

const ordersSeq = async () =>
  (await db.$queryRaw<{ v: string | null }[]>`
    SELECT last_value::text AS v FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'orders_id_seq'`)[0].v;
let seqBefore: string | null;
beforeAll(async () => {
  seqBefore = await ordersSeq();
});

let nextOrderId = -1; // negative ids never collide with real orders and skip the sequence

const order = (tx: Tx, status: "NEW" | "CONFIRMED" | "COMPLETED" | "CANCELLED") =>
  tx.order.create({
    data: {
      id: nextOrderId--,
      customerName: "Test M2.3",
      customerPhone: "6280000000000",
      fulfillment: "PICKUP",
      requestedDate: new Date("2026-11-25T00:00:00Z"),
      status,
    },
  });

const product = (
  tx: Tx,
  data: { type: "PRE_ORDER" | "READY_STOCK"; orderDeadline: string | null; isActive?: boolean },
) =>
  tx.product.create({
    data: {
      name: "Test M2.3",
      category: "Test",
      type: data.type,
      isActive: data.isActive ?? true,
      orderDeadline: data.orderDeadline ? new Date(`${data.orderDeadline}T00:00:00Z`) : null,
    },
  });

describe("statusBarCounts (K3, D17)", { timeout: 60_000 }, () => {
  it("uses the WIB date of the fixed now", () => {
    expect(TODAY).toBe("2026-11-20");
  });

  it("newOrders counts exactly the NEW orders", async () => {
    await rolledBack(async (tx) => {
      const before = await statusBarCounts(tx, TODAY);
      expect(before.newOrders).toBe(await tx.order.count({ where: { status: "NEW" } }));
      await order(tx, "NEW");
      await order(tx, "NEW");
      await order(tx, "CONFIRMED");
      await order(tx, "COMPLETED");
      await order(tx, "CANCELLED");
      const after = await statusBarCounts(tx, TODAY);
      expect(after.newOrders - before.newOrders).toBe(2);
      expect(after.openPreOrders).toBe(before.openPreOrders);
    });
  });

  it("openPreOrders counts active pre-orders whose deadline is today (WIB) or null, nothing else", async () => {
    await rolledBack(async (tx) => {
      const before = await statusBarCounts(tx, TODAY);
      await product(tx, { type: "PRE_ORDER", orderDeadline: "2026-11-20" }); // today: still open
      await product(tx, { type: "PRE_ORDER", orderDeadline: null }); // no deadline
      await product(tx, { type: "PRE_ORDER", orderDeadline: "2026-12-10" }); // later
      await product(tx, { type: "PRE_ORDER", orderDeadline: "2026-11-19" }); // yesterday in WIB (today in UTC)
      await product(tx, { type: "PRE_ORDER", orderDeadline: null, isActive: false }); // hidden
      await product(tx, { type: "READY_STOCK", orderDeadline: null }); // ready stock
      const after = await statusBarCounts(tx, TODAY);
      expect(after.openPreOrders - before.openPreOrders).toBe(3);
      expect(after.newOrders).toBe(before.newOrders);
    });
  });
});

// Runs last in this file: the rolled-back tests above must not have consumed an order id (W5, BSA-M2.3-02).
it("leaves orders_id_seq unchanged", async () => {
  expect(await ordersSeq()).toBe(seqBefore);
});
