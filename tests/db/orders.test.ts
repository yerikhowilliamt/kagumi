// Admin order queries against the development branch (task M2.3 K3), written from the M2 plan D17 and
// System Design §4.9. Every test runs in a transaction that is always rolled back, with a fixed `now` (W5).
// Orders get explicit ids, because ROLLBACK does not undo nextval(); the last test checks orders_id_seq did not move.
import { beforeAll, describe, expect, it } from "vitest";
import { assertDevelopmentDatabase } from "../../prisma/seed.ts";
import { jakartaToday } from "@/lib/order";
import { listOrders, statusBarCounts, statusCounts } from "@/lib/orders";

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

// M2.4 (K2–K5, K8): the order list of the M2 plan D5, D16 and System Design §4.9. Fixtures are named with a run tag,
// so a search by it isolates them from the real orders of the development branch; their created_at is in 2099, so
// they are also the newest. Ids stay negative (or far above the sequence) so no fixture collides with a real order.
const RUN = `M24-${Date.now().toString(36)}`;
const NAME = `Test M2.4 ${RUN}`;

type Line = { unitPrice: number | null; quantity: number };
const listed = (
  tx: Tx,
  data: {
    id?: number;
    name?: string;
    status?: "NEW" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
    createdAt?: Date;
    lines?: Line[];
  },
) =>
  tx.order.create({
    data: {
      id: data.id ?? nextOrderId--,
      customerName: data.name ?? NAME,
      customerPhone: "6280000000000",
      fulfillment: "DELIVERY",
      address: "Jalan Test",
      requestedDate: new Date("2026-12-20T00:00:00Z"),
      status: data.status ?? "NEW",
      createdAt: data.createdAt ?? new Date("2099-01-01T00:00:00Z"),
      items: {
        create: (data.lines ?? [{ unitPrice: 10_000, quantity: 1 }]).map((line, i) => ({
          productName: `Test M2.4 item ${i}`,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
        })),
      },
    },
  });

const all = { status: null, q: "", page: 1 } as const;

describe("listOrders (M2.4, D5, D16)", { timeout: 120_000 }, () => {
  it("newest first by created_at, then id; 50 per page; page 2 holds the 51st; past the last is the last (K2)", async () => {
    await rolledBack(async (tx) => {
      const made: { id: number; createdAt: Date }[] = [];
      for (let i = 0; i < 51; i++) {
        // Pairs share a created_at, so the id tie-break decides their order.
        const o = await listed(tx, { createdAt: new Date(Date.UTC(2099, 0, 1, 0, Math.floor(i / 2))) });
        made.push({ id: o.id, createdAt: o.createdAt });
      }
      const expected = [...made]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
        .map((o) => o.id);

      const first = await listOrders(tx, { status: null, q: NAME, page: 1 });
      expect(first.total).toBe(51);
      expect(first.pageCount).toBe(2);
      expect(first.page).toBe(1);
      expect(first.rows.map((r) => r.id)).toEqual(expected.slice(0, 50));

      const second = await listOrders(tx, { status: null, q: NAME, page: 2 });
      expect(second.page).toBe(2);
      expect(second.rows.map((r) => r.id)).toEqual([expected[50]]);

      const past = await listOrders(tx, { status: null, q: NAME, page: 99 });
      expect(past.page).toBe(2);
      expect(past.rows.map((r) => r.id)).toEqual([expected[50]]);

      // Without a search the 2099 fixtures are the newest of all orders.
      const unfiltered = await listOrders(tx, all);
      expect(unfiltered.rows.map((r) => r.id)).toEqual(expected.slice(0, 50));
      expect(unfiltered.total).toBe(await tx.order.count());
    });
  });

  it("status filter lists only that status; chip counts equal GROUP BY status and ignore the search (K3)", async () => {
    await rolledBack(async (tx) => {
      await listed(tx, { status: "NEW" });
      await listed(tx, { status: "CONFIRMED" });
      await listed(tx, { status: "CONFIRMED" });
      await listed(tx, { status: "CANCELLED" });

      const confirmed = await listOrders(tx, { status: "CONFIRMED", q: NAME, page: 1 });
      expect(confirmed.total).toBe(2);
      expect(confirmed.rows.map((r) => r.status)).toEqual(["CONFIRMED", "CONFIRMED"]);
      expect((await listOrders(tx, { status: null, q: NAME, page: 1 })).total).toBe(4);
      const everyConfirmed = await listOrders(tx, { status: "CONFIRMED", q: "", page: 1 });
      expect(everyConfirmed.rows.every((r) => r.status === "CONFIRMED")).toBe(true);
      expect(everyConfirmed.total).toBe(await tx.order.count({ where: { status: "CONFIRMED" } }));

      const grouped = await tx.$queryRaw<{ status: string; n: bigint }[]>`
        SELECT status::text AS status, count(*) AS n FROM orders GROUP BY status`;
      const expected = { all: 0, NEW: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 };
      for (const g of grouped) {
        expected[g.status as keyof typeof expected] = Number(g.n);
        expected.all += Number(g.n);
      }
      expect(await statusCounts(tx)).toEqual(expected);
      expect(expected.CONFIRMED).toBeGreaterThanOrEqual(2);
    });
  });

  it("search: a name part in any case; %, _ and \\ literal; empty lists all (K4, C6)", async () => {
    await rolledBack(async (tx) => {
      const plain = await listed(tx, { name: `Rina Wulandari ${RUN}` });
      const percent = await listed(tx, { name: `${NAME} a%b` });
      const under = await listed(tx, { name: `${NAME} a_b` });
      const slash = await listed(tx, { name: `${NAME} a\\b` });
      const other = await listed(tx, { name: `${NAME} axb` });

      const ids = async (q: string) => (await listOrders(tx, { status: null, q, page: 1 })).rows.map((r) => r.id);
      expect(await ids(`wULANDARI ${RUN.toLowerCase()}`)).toEqual([plain.id]);
      expect(await ids(`${NAME} a%b`)).toEqual([percent.id]);
      expect(await ids(`${NAME} a_b`)).toEqual([under.id]);
      expect(await ids(`${NAME} a\\b`)).toEqual([slash.id]);
      expect(await ids(`${NAME} axb`)).toEqual([other.id]);

      // A bare wildcard matches only names that contain it.
      for (const wildcard of ["%", "_", "\\"]) {
        const result = await listOrders(tx, { status: null, q: wildcard, page: 1 });
        expect(result.rows.length).toBeGreaterThan(0);
        expect(result.rows.every((r) => r.customerName.includes(wildcard))).toBe(true);
      }

      const everything = await listOrders(tx, all);
      expect(everything.total).toBe(await tx.order.count());
    });
  });

  it("a number form finds the id and still searches names; 'KD-' alone searches names only (K4)", async () => {
    await rolledBack(async (tx) => {
      // Far above orders_id_seq, so no real order has it; an explicit id does not move the sequence.
      const byId = await listed(tx, { id: 999_999_123 });
      const byName = await listed(tx, { name: `${NAME} KD-999999123` });
      const kdName = await listed(tx, { name: `${NAME} kd-x` });

      const ids = async (q: string) => (await listOrders(tx, { status: null, q, page: 1 })).rows.map((r) => r.id).sort();
      expect(await ids("KD-999999123")).toEqual([byId.id, byName.id].sort());
      expect(await ids("#KD-0999999123")).toEqual([byId.id]);
      expect(await ids("999999123")).toEqual([byId.id, byName.id].sort());

      const kd = await listOrders(tx, { status: null, q: "KD-", page: 1 });
      expect(kd.rows.map((r) => r.id)).toContain(kdName.id);
      expect(kd.rows.every((r) => r.customerName.toLowerCase().includes("kd-"))).toBe(true);
    });
  });

  it("row: item count is the sum of quantities, subtotal of priced lines, unpriced quantity (K5)", async () => {
    await rolledBack(async (tx) => {
      const mixed = await listed(tx, {
        lines: [
          { unitPrice: 85_000, quantity: 2 },
          { unitPrice: null, quantity: 1 },
        ],
      });
      const none = await listed(tx, { lines: [{ unitPrice: null, quantity: 4 }] });
      const rows = (await listOrders(tx, { status: null, q: NAME, page: 1 })).rows;
      const row = rows.find((r) => r.id === mixed.id)!;
      expect(row).toMatchObject({
        customerName: NAME,
        fulfillment: "DELIVERY",
        requestedDate: "2026-12-20",
        status: "NEW",
        quantity: 3,
        subtotal: 170_000,
        unpriced: 1,
      });
      expect(row.createdAt).toEqual(new Date("2099-01-01T00:00:00Z"));
      expect(rows.find((r) => r.id === none.id)).toMatchObject({ quantity: 4, subtotal: 0, unpriced: 4 });
    });
  });

  it("with no orders at all: no rows, a total of 0, page 1 of 1 (K8, R11)", async () => {
    await rolledBack(async (tx) => {
      await tx.order.deleteMany({});
      expect(await listOrders(tx, all)).toEqual({ rows: [], total: 0, page: 1, pageCount: 1 });
      expect(await listOrders(tx, { status: "NEW", q: "x", page: 5 })).toEqual({ rows: [], total: 0, page: 1, pageCount: 1 });
      expect(await statusCounts(tx)).toEqual({ all: 0, NEW: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 });
    });
  });
});

// Runs last in this file: the rolled-back tests above must not have consumed an order id (W5, BSA-M2.3-02).
it("leaves orders_id_seq unchanged", async () => {
  expect(await ordersSeq()).toBe(seqBefore);
});
