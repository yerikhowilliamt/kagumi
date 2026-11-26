// Admin order queries against the development branch (task M2.3 K3), written from the M2 plan D17 and
// System Design §4.9. Every test runs in a transaction that is always rolled back, with a fixed `now` (W5).
// Orders get explicit ids, because ROLLBACK does not undo nextval(); the last test checks orders_id_seq did not move.
// M2.5 (D15) commits fixture orders on purpose (W5): see the "committed fixtures" block below.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDevelopmentDatabase } from "../../prisma/seed.ts";
import { jakartaToday } from "@/lib/order";
import { ORDER_STATUSES, changeOrderStatus, getOrder, listOrders, parseOrderQuery, statusBarCounts, statusCounts, type OrderStatus } from "@/lib/orders";

// setOrderStatus (M2.5 K5): the session is the gate test's job (tests/admin-actions.test.ts), so requireAdmin
// passes here; revalidatePath needs a Next request, so it is recorded instead.
const { requireAdmin, revalidatePath } = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ adminId: "test", sessionId: "test" })),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("next/cache", () => ({ revalidatePath }));

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
type Fixture = {
  id?: number;
  name?: string;
  status?: "NEW" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
  createdAt?: Date;
  lines?: Line[];
};
/** The order's own columns; `listed` adds its items. */
const orderRow = (data: Fixture) => ({
  id: data.id ?? nextOrderId--,
  customerName: data.name ?? NAME,
  customerPhone: "6280000000000",
  fulfillment: "DELIVERY" as const,
  address: "Jalan Test",
  requestedDate: new Date("2026-12-20T00:00:00Z"),
  status: data.status ?? ("NEW" as const),
  createdAt: data.createdAt ?? new Date("2099-01-01T00:00:00Z"),
});
const listed = (tx: Tx, data: Fixture) =>
  tx.order.create({
    data: {
      ...orderRow(data),
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
      // Pairs share a created_at, so the id tie-break decides their order.
      const made = Array.from({ length: 51 }, (_, i) => orderRow({ createdAt: new Date(Date.UTC(2099, 0, 1, 0, Math.floor(i / 2))) }));
      // Two statements, not 51 nested creates: over a slow link those passed the 30 s transaction timeout (ERR-005).
      await tx.order.createMany({ data: made });
      await tx.orderItem.createMany({ data: made.map((o) => ({ orderId: o.id, productName: "Test M2.4 item 0", unitPrice: 10_000, quantity: 1 })) });
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

  it("a q that held U+0000 searches normally instead of throwing (BSA-M2.4-02)", async () => {
    await rolledBack(async (tx) => {
      await expect(listOrders(tx, parseOrderQuery({ q: "\u0000" }))).resolves.toMatchObject({ page: 1 });
      await expect(listOrders(tx, parseOrderQuery({ q: "a\u0000b" }))).resolves.toMatchObject({ page: 1 });
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

// ---- M2.5: order detail and status change (M2 plan D15, D18; System Design §4.9 and §10) ----

describe("getOrder (M2.5, D18)", { timeout: 60_000 }, () => {
  it("returns the fields, the lines in insertion order and the history newest first; null for an unknown id", async () => {
    await rolledBack(async (tx) => {
      const made = await tx.order.create({
        data: {
          id: nextOrderId--,
          customerName: "Test M2.5",
          customerPhone: "6280000000000",
          fulfillment: "DELIVERY",
          address: "Jalan Test",
          requestedDate: new Date("2026-12-20T00:00:00Z"),
          note: "Catatan test",
          items: {
            create: [
              { productName: "Kastengel", unitPrice: 85_000, quantity: 2 },
              { productName: "Bolu Gulung", unitPrice: null, quantity: 1 },
            ],
          },
          statusChanges: { create: [{ fromStatus: null, toStatus: "NEW", createdAt: new Date("2026-11-20T01:00:00Z") }] },
        },
      });
      await tx.orderStatusChange.create({
        data: { orderId: made.id, fromStatus: "NEW", toStatus: "CONFIRMED", createdAt: new Date("2026-11-20T02:00:00Z") },
      });
      const found = await getOrder(tx, made.id);
      expect(found).toMatchObject({
        id: made.id,
        customerName: "Test M2.5",
        customerPhone: "6280000000000",
        fulfillment: "DELIVERY",
        address: "Jalan Test",
        requestedDate: "2026-12-20",
        note: "Catatan test",
        status: "NEW",
      });
      expect(found!.items.map(({ productName, unitPrice, quantity }) => ({ productName, unitPrice, quantity }))).toEqual([
        { productName: "Kastengel", unitPrice: 85_000, quantity: 2 },
        { productName: "Bolu Gulung", unitPrice: null, quantity: 1 },
      ]);
      expect(found!.statusChanges.map((c) => [c.fromStatus, c.toStatus])).toEqual([
        ["NEW", "CONFIRMED"],
        [null, "NEW"],
      ]);
      expect(await getOrder(tx, nextOrderId--)).toBeNull();
    });
  });
});

const history = (client: Tx | typeof db, orderId: number) =>
  client.orderStatusChange.findMany({ where: { orderId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const pairs = (rows: { fromStatus: OrderStatus | null; toStatus: OrderStatus }[]) => rows.map((r) => [r.fromStatus, r.toStatus]);

describe("changeOrderStatus (M2.5 K3, D15)", { timeout: 120_000 }, () => {
  it("NEW → CONFIRMED updates the status and inserts exactly one history row { NEW → CONFIRMED }", async () => {
    await rolledBack(async (tx) => {
      const { id } = await order(tx, "NEW");
      await expect(changeOrderStatus(tx, id, "CONFIRMED")).resolves.toEqual({ ok: true, changed: true });
      expect((await tx.order.findUniqueOrThrow({ where: { id } })).status).toBe("CONFIRMED");
      expect(pairs(await history(tx, id))).toEqual([["NEW", "CONFIRMED"]]);
    });
  });

  it("accepts every one of the twelve pairs of different statuses (FR29)", async () => {
    await rolledBack(async (tx) => {
      let tried = 0;
      for (const from of ORDER_STATUSES) {
        for (const to of ORDER_STATUSES) {
          if (from === to) continue;
          const { id } = await order(tx, from);
          await expect(changeOrderStatus(tx, id, to), `${from} → ${to}`).resolves.toEqual({ ok: true, changed: true });
          expect((await tx.order.findUniqueOrThrow({ where: { id } })).status).toBe(to);
          expect(pairs(await history(tx, id))).toEqual([[from, to]]);
          tried++;
        }
      }
      expect(tried).toBe(12);
    });
  });

  it("the same status returns changed: false and writes nothing", async () => {
    await rolledBack(async (tx) => {
      for (const status of ORDER_STATUSES) {
        const { id } = await order(tx, status);
        const before = await tx.order.findUniqueOrThrow({ where: { id } });
        await expect(changeOrderStatus(tx, id, status)).resolves.toEqual({ ok: true, changed: false });
        expect(await tx.order.findUniqueOrThrow({ where: { id } })).toEqual(before);
        expect(await history(tx, id)).toEqual([]);
      }
    });
  });

  it("an unknown id returns not_found and writes nothing", async () => {
    await rolledBack(async (tx) => {
      const id = nextOrderId--;
      const changes = await tx.orderStatusChange.count();
      await expect(changeOrderStatus(tx, id, "CONFIRMED")).resolves.toEqual({ ok: false, error: "not_found" });
      expect(await tx.orderStatusChange.count()).toBe(changes);
    });
  });
});

// Committed fixtures (W5): ids above 2 100 000 000 never come from orders_id_seq (it stays unchanged, see the last
// test) and never meet a real order; every one is deleted in afterAll, its history with it (cascade).
describe("committed fixtures: fault injection, barrier, setOrderStatus (M2.5 K3–K5, D15)", { timeout: 120_000 }, () => {
  const committed: number[] = [];
  const TX = { maxWait: 10_000, timeout: 60_000 };

  async function fixture() {
    const id = 2_100_000_000 + Math.floor(Math.random() * 47_000_000);
    committed.push(id);
    await db.order.create({
      data: {
        id,
        customerName: "Test M2.5",
        customerPhone: "6280000000000",
        fulfillment: "PICKUP",
        requestedDate: new Date("2026-11-25T00:00:00Z"),
        statusChanges: { create: [{ fromStatus: null, toStatus: "NEW" }] },
      },
    });
    return id;
  }

  afterAll(async () => {
    await db.order.deleteMany({ where: { id: { in: committed } } });
    expect(await db.order.count({ where: { id: { in: committed } } })).toBe(0);
  });

  beforeEach(() => {
    requireAdmin.mockClear();
    revalidatePath.mockClear();
  });

  it("fault injection: when the history insert rejects, the committed order keeps its status and its history", async () => {
    const id = await fixture();
    const injected = new Error("injected history failure");
    let statusInside: string | undefined;
    await expect(
      db.$transaction(async (tx) => {
        // The transaction client with only orderStatusChange.create replaced; everything else is the real tx.
        const failing = new Proxy(tx, {
          get(target, prop) {
            if (prop === "orderStatusChange") {
              return {
                create: async () => {
                  statusInside = (await tx.order.findUniqueOrThrow({ where: { id } })).status;
                  throw injected;
                },
              };
            }
            const value = Reflect.get(target, prop);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return changeOrderStatus(failing, id, "CONFIRMED");
      }, TX),
    ).rejects.toBe(injected);
    // The update had run inside the transaction before the insert failed, and the rollback undid it.
    expect(statusInside).toBe("CONFIRMED");
    expect((await db.order.findUniqueOrThrow({ where: { id } })).status).toBe("NEW");
    expect(pairs(await history(db, id))).toEqual([[null, "NEW"]]);
  });

  it("barrier (K4): B waits for A's row lock, so the history reads NULL → NEW, NEW → A, A → B, in that order", async () => {
    const id = await fixture();
    const signal = () => {
      let open!: () => void;
      const opened = new Promise<void>((resolve) => (open = resolve));
      return { open, opened };
    };
    const bBegun = signal();
    const aLocked = signal();
    const release = signal();
    let aPid = 0;
    let aStart = new Date(0);
    let bStart = new Date(0);
    let bSettled = false;

    // B begins first, so its now() is earlier than A's: the display order must still follow the lock (O3).
    const b = db.$transaction(async (tx) => {
      bStart = (await tx.$queryRaw<{ t: Date }[]>`SELECT now() AS t`)[0].t;
      bBegun.open();
      await aLocked.opened;
      return changeOrderStatus(tx, id, "COMPLETED");
    }, TX);
    b.finally(() => (bSettled = true)).catch(() => {});
    await bBegun.opened;

    const a = db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ pid: number; t: Date }[]>`SELECT pg_backend_pid() AS pid, now() AS t`;
      aPid = row.pid;
      aStart = row.t;
      const result = await changeOrderStatus(tx, id, "CONFIRMED");
      aLocked.open();
      await release.opened;
      return result;
    }, TX);
    await aLocked.opened;

    // The barrier: wait until Postgres reports a backend blocked by A (B, on the order row). No sleep.
    await expect
      .poll(
        async () =>
          Number(
            (await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE ${aPid}::int = ANY(pg_blocking_pids(pid))`)[0].n,
          ),
        { timeout: 30_000 },
      )
      .toBe(1);
    expect(bSettled).toBe(false);
    expect(bStart.getTime()).toBeLessThan(aStart.getTime());

    release.open();
    await expect(a).resolves.toEqual({ ok: true, changed: true });
    await expect(b).resolves.toEqual({ ok: true, changed: true });

    expect((await db.order.findUniqueOrThrow({ where: { id } })).status).toBe("COMPLETED");
    const chain = [
      [null, "NEW"],
      ["NEW", "CONFIRMED"],
      ["CONFIRMED", "COMPLETED"],
    ];
    expect(pairs(await history(db, id))).toEqual(chain);
    // The detail page's order (newest first) is the same chain reversed.
    expect(pairs((await getOrder(db, id))!.statusChanges)).toEqual([...chain].reverse());
  });

  it("barrier, same status (BSA-M2.5-03): the change that waited sees the new status and writes nothing", async () => {
    const id = await fixture();
    let open!: () => void;
    const aLocked = new Promise<void>((resolve) => (open = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let aPid = 0;
    const a = db.$transaction(async (tx) => {
      aPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
      const result = await changeOrderStatus(tx, id, "CONFIRMED");
      open();
      await released;
      return result;
    }, TX);
    await aLocked;
    const b = db.$transaction((tx) => changeOrderStatus(tx, id, "CONFIRMED"), TX);
    await expect
      .poll(
        async () =>
          Number(
            (await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE ${aPid}::int = ANY(pg_blocking_pids(pid))`)[0].n,
          ),
        { timeout: 30_000 },
      )
      .toBe(1);
    release();
    expect(await Promise.all([a, b])).toEqual([
      { ok: true, changed: true },
      { ok: true, changed: false },
    ]);
    expect(pairs(await history(db, id))).toEqual([
      [null, "NEW"],
      ["NEW", "CONFIRMED"],
    ]);
  });

  it("setOrderStatus: a non-integer or out-of-range id or an unknown status returns validation and writes nothing (K5)", async () => {
    const { setOrderStatus } = await import("@/app/admin/(protected)/pesanan/actions");
    const id = await fixture();
    const bad: [unknown, unknown][] = [
      [String(id), "CONFIRMED"],
      [id + 0.5, "CONFIRMED"],
      [0, "CONFIRMED"],
      [-1, "CONFIRMED"],
      [2_147_483_648, "CONFIRMED"],
      [Number.NaN, "CONFIRMED"],
      [null, "CONFIRMED"],
      [id, "BOGUS"],
      [id, "confirmed"],
      [id, undefined],
    ];
    for (const [orderId, status] of bad) {
      await expect(
        setOrderStatus(orderId as number, status as OrderStatus),
        `${String(orderId)} ${String(status)}`,
      ).resolves.toEqual({ ok: false, error: "validation" });
    }
    expect(requireAdmin).toHaveBeenCalledTimes(bad.length);
    expect((await db.order.findUniqueOrThrow({ where: { id } })).status).toBe("NEW");
    expect(pairs(await history(db, id))).toEqual([[null, "NEW"]]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("setOrderStatus: a change writes and revalidates the admin layout; the same status and an unknown id do not", async () => {
    const { setOrderStatus } = await import("@/app/admin/(protected)/pesanan/actions");
    const id = await fixture();
    await expect(setOrderStatus(id, "NEW")).resolves.toEqual({ ok: true, changed: false });
    await expect(setOrderStatus(2_099_999_999, "CONFIRMED")).resolves.toEqual({ ok: false, error: "not_found" });
    expect(revalidatePath).not.toHaveBeenCalled();

    await expect(setOrderStatus(id, "CANCELLED")).resolves.toEqual({ ok: true, changed: true });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/admin", "layout");
    expect(pairs(await history(db, id))).toEqual([
      [null, "NEW"],
      ["NEW", "CANCELLED"],
    ]);
  });

  it("setOrderStatus: a throw returns server, logs only the error name and code, and revalidates nothing", async () => {
    const { setOrderStatus } = await import("@/app/admin/(protected)/pesanan/actions");
    const id = await fixture();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const transaction = vi
      .spyOn(db, "$transaction")
      .mockRejectedValueOnce(
        Object.assign(new Error("connection failed for Test M2.5 6280000000000"), { name: "PrismaClientKnownRequestError", code: "P1001" }),
      );
    try {
      await expect(setOrderStatus(id, "CONFIRMED")).resolves.toEqual({ ok: false, error: "server" });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]).toEqual(["[setOrderStatus] failed", "PrismaClientKnownRequestError", "P1001"]);
      expect(JSON.stringify(spy.mock.calls)).not.toContain("6280000000000");
    } finally {
      transaction.mockRestore();
      spy.mockRestore();
    }
    expect(revalidatePath).not.toHaveBeenCalled();
    expect((await db.order.findUniqueOrThrow({ where: { id } })).status).toBe("NEW");
  });
});

// Runs last in this file: the rolled-back tests above must not have consumed an order id (W5, BSA-M2.3-02).
it("leaves orders_id_seq unchanged", async () => {
  expect(await ordersSeq()).toBe(seqBefore);
});
