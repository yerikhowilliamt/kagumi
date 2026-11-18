// placeOrder against the development branch (task M1.6 K2–K7), written from the milestone plan
// (D2 §4.4, D5 §4.5, D7 §4.6) and System Design §4.3. Every checkout runs inside a transaction
// that is always rolled back; orders_id_seq still moves (W2). Committed rows, all deleted in afterAll:
// the barrier test's one rate_limits row under a random key, and from the checkout() tests (TEC-M1.6-02,
// approved 2026-11-18) one order with its item, status change and event plus three rate_limits rows,
// under names and keys unique to the run. They use the seeded Kastengel and Nastar and change no product.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { assertDevelopmentDatabase } from "../../prisma/seed.ts";
import { checkout, placeOrder } from "@/lib/checkout";
import { jakartaToday } from "@/lib/order";
import { hitRateLimit, visitorHash as hashVisitor } from "@/lib/tracking";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set: tests/db needs the development branch in .env");
}
assertDevelopmentDatabase();

const { db } = await import("@/lib/db");

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
const ROLLBACK = new Error("rollback");

/** Runs fn in a transaction that is always rolled back and returns what fn returned. */
async function rolledBack<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await expect(
    db.$transaction(
      async (tx) => {
        out = await fn(tx);
        throw ROLLBACK;
      },
      { timeout: 30_000 },
    ),
  ).rejects.toBe(ROLLBACK);
  return out as T;
}

const NOW = new Date("2026-11-20T03:04:30Z"); // 10:04:30 WIB on 2026-11-20; window 03:00:00Z
const WINDOW = new Date("2026-11-20T03:00:00Z");
const newVisitor = () => randomBytes(32).toString("hex");

async function product(
  tx: Tx,
  data: { name: string; price?: number | null; isActive?: boolean; orderDeadline?: string | null },
) {
  return tx.product.create({
    data: {
      name: data.name,
      category: "Test",
      type: data.orderDeadline ? "PRE_ORDER" : "READY_STOCK",
      price: data.price ?? null,
      isActive: data.isActive ?? true,
      orderDeadline: data.orderDeadline ? new Date(`${data.orderDeadline}T00:00:00Z`) : null,
    },
  });
}

const customer = (name: string) => ({
  customerName: name,
  customerPhone: "0812-3456-7890",
  fulfillment: "PICKUP",
  address: "dropped for pickup",
  requestedDate: "2026-11-25",
  note: "   ",
});

const rateRows = (tx: Tx, key: string) =>
  tx.$queryRaw<{ window_start: Date; count: number }[]>`
    SELECT window_start, count FROM rate_limits WHERE key = ${key} ORDER BY window_start`;

describe("placeOrder: a valid checkout (K2, K3)", { timeout: 60_000 }, () => {
  it("writes the order, its snapshot items, NULL → NEW and one CHECKOUT event, and returns KD- and waUrl", async () => {
    const visitor = newVisitor();
    const name = `Checkout Test ${randomUUID()}`;
    const r = await rolledBack(async (tx) => {
      const priced = await product(tx, { name: "Test Priced", price: 35000, orderDeadline: "2026-12-10" });
      const unpriced = await product(tx, { name: "Test Unpriced" });
      const result = await placeOrder(
        tx,
        {
          ...customer(name),
          items: [
            // Names and prices sent by the client are never read (D2).
            { productId: priced.id, quantity: 2, name: "Fake Name", unitPrice: 1, price: 1 },
            { productId: unpriced.id.toUpperCase(), quantity: 1, productName: "Fake", unitPrice: 999 },
          ],
          orderNumber: "KD-9999",
        },
        { visitorHash: visitor, now: NOW },
      );
      const orders = await tx.order.findMany({
        where: { customerName: name },
        include: { items: true, statusChanges: true },
      });
      const events = await tx.event.findMany({ where: { visitorHash: visitor } });
      return { result, orders, events, priced, unpriced };
    });

    expect(r.orders).toHaveLength(1);
    const [order] = r.orders;
    expect(r.result).toEqual({ ok: true, orderNumber: `KD-${String(order.id).padStart(4, "0")}`, waUrl: expect.any(String) });
    expect(order).toMatchObject({
      customerPhone: "6281234567890",
      fulfillment: "PICKUP",
      address: null,
      note: null,
      status: "NEW",
      requestedDate: new Date("2026-11-25T00:00:00Z"),
    });
    const items = order.items.map(({ productId, productName, unitPrice, quantity }) => ({ productId, productName, unitPrice, quantity }));
    expect(items).toEqual(
      expect.arrayContaining([
        { productId: r.priced.id, productName: "Test Priced", unitPrice: 35000, quantity: 2 },
        { productId: r.unpriced.id, productName: "Test Unpriced", unitPrice: null, quantity: 1 },
      ]),
    );
    expect(items).toHaveLength(2);
    expect(order.statusChanges.map(({ fromStatus, toStatus }) => ({ fromStatus, toStatus }))).toEqual([{ fromStatus: null, toStatus: "NEW" }]);
    expect(r.events.map(({ type, productId, visitorHash }) => ({ type, productId, visitorHash }))).toEqual([
      { type: "CHECKOUT", productId: null, visitorHash: visitor },
    ]);

    // K3: the message of System Design §4.3, from the database snapshot, in cart order.
    if (!r.result.ok) throw new Error("expected ok");
    const url = new URL(r.result.waUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://wa.me/6285159545168");
    const text = url.searchParams.get("text");
    expect(text).toBe(
      [
        "Halo Kagumi Dough! Aku mau pesan (dari website)",
        "",
        `No. pesanan: ${r.result.orderNumber}`,
        "• 2× Test Priced — Rp70.000",
        "• 1× Test Unpriced — harga via WA",
        "",
        "Subtotal: Rp70.000 (+ 1 produk harga via WA)",
        `Nama: ${name}`,
        "Pengambilan: Ambil sendiri",
        "Tanggal: Rabu, 25 November 2026",
      ].join("\n"),
    );
    expect(text).not.toContain("6281234567890");
    expect(text).not.toContain("0812");
    expect(text).not.toContain("Fake");
  });
});

describe("placeOrder: a delivery order (TEC-M1.6-04)", { timeout: 60_000 }, () => {
  it("stores the trimmed address and note, and puts them into the message", async () => {
    const name = `Delivery Test ${randomUUID()}`;
    const r = await rolledBack(async (tx) => {
      const p = await product(tx, { name: "Test Delivery", price: 20000 });
      const result = await placeOrder(
        tx,
        {
          ...customer(name),
          fulfillment: "DELIVERY",
          address: "  Jl. Uji Coba No. 1  ",
          note: "  Kartu ucapan  ",
          items: [{ productId: p.id, quantity: 1 }],
        },
        { visitorHash: newVisitor(), now: NOW },
      );
      return { result, order: await tx.order.findFirst({ where: { customerName: name } }) };
    });
    expect(r.order).toMatchObject({ fulfillment: "DELIVERY", address: "Jl. Uji Coba No. 1", note: "Kartu ucapan" });
    if (!r.result.ok) throw new Error("expected ok");
    const text = new URL(r.result.waUrl).searchParams.get("text")!;
    expect(text.split("\n").slice(-4)).toEqual([
      "Pengambilan: Diantar",
      "Alamat: Jl. Uji Coba No. 1",
      "Tanggal: Rabu, 25 November 2026",
      "Catatan: Kartu ucapan",
    ]);
  });
});

describe("placeOrder: rejected lines (K4, FR12)", { timeout: 60_000 }, () => {
  it("reports every bad line with its reason, writes no order, and counts the attempt", async () => {
    const visitor = newVisitor();
    const missing = randomUUID();
    const r = await rolledBack(async (tx) => {
      const good = await product(tx, { name: "Test Good", price: 10000 });
      const hidden = await product(tx, { name: "Test Hidden", isActive: false });
      const yesterday = await product(tx, { name: "Test Yesterday", orderDeadline: "2026-11-19" });
      const ordersBefore = await tx.order.count();
      const result = await placeOrder(
        tx,
        {
          ...customer("Rejected Test"),
          items: [
            { productId: missing, quantity: 1 },
            { productId: good.id, quantity: 1 },
            { productId: hidden.id, quantity: 1 },
            { productId: yesterday.id, quantity: 1 },
          ],
        },
        { visitorHash: visitor, now: NOW },
      );
      return {
        result,
        ids: { hidden: hidden.id, yesterday: yesterday.id },
        ordersAfter: await tx.order.count(),
        ordersBefore,
        events: await tx.event.count({ where: { visitorHash: visitor } }),
        rate: await rateRows(tx, `checkout:${visitor}`),
      };
    });
    expect(r.result).toEqual({
      ok: false,
      error: "rejected",
      lines: [
        { productId: missing, reason: "unavailable" },
        { productId: r.ids.hidden, reason: "unavailable" },
        { productId: r.ids.yesterday, reason: "closed" },
      ],
    });
    expect(r.ordersAfter).toBe(r.ordersBefore);
    expect(r.events).toBe(0);
    expect(r.rate.map((row) => row.count)).toEqual([1]); // D5: a rejected cart counts
  });

  it("accepts a product whose deadline is today in WIB, also late in the WIB day", async () => {
    const r = await rolledBack(async (tx) => {
      const today = await product(tx, { name: "Test Today", price: 5000, orderDeadline: "2026-11-20" });
      const input = { ...customer("Today Test"), requestedDate: "2026-11-20", items: [{ productId: today.id, quantity: 1 }] };
      return [
        await placeOrder(tx, input, { visitorHash: newVisitor(), now: NOW }),
        // 23:59 WIB on 2026-11-20 is 16:59 UTC: still the deadline day.
        await placeOrder(tx, input, { visitorHash: newVisitor(), now: new Date("2026-11-20T16:59:00Z") }),
        // 00:00 WIB on 2026-11-21: closed.
        await placeOrder(tx, { ...input, requestedDate: "2026-11-21" }, { visitorHash: newVisitor(), now: new Date("2026-11-20T17:00:00Z") }),
      ];
    });
    expect(r[0]).toMatchObject({ ok: true });
    expect(r[1]).toMatchObject({ ok: true });
    expect(r[2]).toMatchObject({ ok: false, error: "rejected", lines: [{ reason: "closed" }] });
  });
});

describe("placeOrder: invalid input (K5)", { timeout: 60_000 }, () => {
  it("returns validation with one message per field and writes nothing, not even the counter", async () => {
    const visitor = newVisitor();
    const r = await rolledBack(async (tx) => {
      const ordersBefore = await tx.order.count();
      const result = await placeOrder(
        tx,
        {
          customerName: "  ",
          customerPhone: "12345",
          fulfillment: "DELIVERY",
          address: "",
          requestedDate: "2026-11-19",
          items: [],
          extra: "ignored",
        },
        { visitorHash: visitor, now: NOW },
      );
      const nonObject = await placeOrder(tx, "not an object", { visitorHash: visitor, now: NOW });
      return { result, nonObject, ordersBefore, ordersAfter: await tx.order.count(), rate: await rateRows(tx, `checkout:${visitor}`) };
    });
    expect(r.result).toEqual({
      ok: false,
      error: "validation",
      fields: {
        customerName: "Nama wajib diisi.",
        customerPhone: "Isi nomor WhatsApp yang benar, contoh 0812-3456-7890.",
        address: "Alamat wajib diisi untuk pengantaran.",
        requestedDate: "Tanggal tidak boleh sebelum hari ini.",
        items: "Keranjang tidak valid. Muat ulang halaman lalu coba lagi.",
      },
    });
    expect(r.nonObject).toEqual({ ok: false, error: "validation", fields: {} });
    expect(r.ordersAfter).toBe(r.ordersBefore);
    expect(r.rate).toEqual([]);
  });
});

describe("placeOrder: rate limit (K6, D5)", { timeout: 60_000 }, () => {
  it("allows five checkouts per visitor per fixed 10-minute UTC window", async () => {
    const visitor = newVisitor();
    const other = newVisitor();
    const name = `Rate Test ${randomUUID()}`;
    const r = await rolledBack(async (tx) => {
      const p = await product(tx, { name: "Test Rate", price: 1000 });
      const input = { ...customer(name), items: [{ productId: p.id, quantity: 1 }] };
      const results = [];
      for (let i = 0; i < 6; i++) results.push(await placeOrder(tx, input, { visitorHash: visitor, now: NOW }));
      const otherVisitor = await placeOrder(tx, input, { visitorHash: other, now: NOW });
      const nextWindow = await placeOrder(tx, input, { visitorHash: visitor, now: new Date("2026-11-20T03:10:00Z") });
      return {
        results,
        otherVisitor,
        nextWindow,
        orders: await tx.order.count({ where: { customerName: name } }),
        rate: await rateRows(tx, `checkout:${visitor}`),
      };
    });
    expect(r.results.slice(0, 5).every((x) => x.ok)).toBe(true);
    expect(r.results[5]).toEqual({ ok: false, error: "rate_limited" });
    expect(r.otherVisitor).toMatchObject({ ok: true });
    expect(r.nextWindow).toMatchObject({ ok: true });
    expect(r.orders).toBe(7); // 5 + other visitor + next window; the sixth wrote no order
    expect(r.rate).toEqual([
      { window_start: WINDOW, count: 6 },
      { window_start: new Date("2026-11-20T03:10:00Z"), count: 1 },
    ]);
    expect(r.rate.every((row) => row.window_start.getTime() % 600_000 === 0)).toBe(true);
  });
});

describe("hitRateLimit under concurrency (K7)", { timeout: 60_000 }, () => {
  const key = `test:barrier:${createHash("sha256").update(randomUUID()).digest("hex").slice(0, 40)}`;
  afterAll(async () => {
    await db.rateLimit.deleteMany({ where: { key } });
  });

  it("counts both increments when B runs while A holds the row", async () => {
    await db.$executeRaw`INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${WINDOW}, 3)`;

    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => (releaseA = resolve));
    let signalA!: () => void;
    const aIncremented = new Promise<void>((resolve) => (signalA = resolve));

    const backendPid = async (tx: Tx) => (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
    let pidA = 0;
    let pidB = 0;
    let signalB!: () => void;
    const bStarted = new Promise<void>((resolve) => (signalB = resolve));
    const a = db.$transaction(
      async (tx) => {
        pidA = await backendPid(tx);
        await hitRateLimit(tx, key, NOW, 100);
        signalA();
        await gateA;
      },
      { timeout: 30_000 },
    );
    await aIncremented;
    const b = db.$transaction(
      async (tx) => {
        pidB = await backendPid(tx);
        signalB();
        return hitRateLimit(tx, key, NOW, 100);
      },
      { timeout: 30_000 },
    );

    // Barrier: B's own backend is blocked by A's backend (the row lock) before A commits (TEC-M1.6-03).
    await bStarted;
    let waiting = false;
    for (let i = 0; i < 200 && !waiting; i++) {
      const [{ blocked }] = await db.$queryRaw<{ blocked: boolean }[]>`
        SELECT ${pidA}::int = ANY(pg_blocking_pids(${pidB}::int)) AS blocked`;
      waiting = blocked;
    }
    releaseA();
    await a;
    await b;
    expect(waiting, "B never waited for A's lock").toBe(true);

    const [{ count }] = await db.$queryRaw<{ count: number }[]>`
      SELECT count FROM rate_limits WHERE key = ${key} AND window_start = ${WINDOW}`;
    expect(count).toBe(5);
  });
});

describe("checkout() against the database: what commits (BSA-M1.6-02, TEC-M1.6-02)", { timeout: 60_000 }, () => {
  // The D7 seed fixtures (npx prisma db seed): Kastengel is open and priced, Nastar closed since 2026-11-01.
  // No product is created or changed, so the storefront never sees test data (TR-M1.6-02).
  const run = randomUUID();
  const secret = `test-secret-${run}`;
  const now = new Date();
  const ctx = (ua: string) => ({ ip: "203.0.113.7", ua: `kagumi-test ${run} ${ua}`, secret, now });
  const keyOf = (ua: string) => `checkout:${hashVisitor(ctx(ua))}`;
  const names = { ok: `Commit Test ${run}`, nul: `Nul Test ${run}` };

  async function seeded(name: string) {
    const p = await db.product.findFirst({ where: { name, isActive: true } });
    if (!p) throw new Error(`seed product ${name} is missing: run npx prisma db seed`);
    return p;
  }
  const input = (name: string, productId: string) => ({
    customerName: name,
    customerPhone: "081200000000",
    fulfillment: "PICKUP",
    requestedDate: jakartaToday(now),
    items: [{ productId, quantity: 1 }],
  });

  afterAll(async () => {
    const hashes = ["ok", "rejected", "limited", "nul"].map((ua) => hashVisitor(ctx(ua)));
    await db.order.deleteMany({ where: { customerName: { in: [names.ok, names.nul] } } });
    await db.event.deleteMany({ where: { visitorHash: { in: hashes } } });
    await db.rateLimit.deleteMany({ where: { key: { in: hashes.map((h) => `checkout:${h}`) } } });
  });

  it("commits the order, the event and the counter with the default transaction options", async () => {
    const kastengel = await seeded("Kastengel");
    const result = await checkout(db, input(names.ok, kastengel.id), ctx("ok"));
    expect(result).toMatchObject({ ok: true });
    const order = await db.order.findFirst({ where: { customerName: names.ok }, include: { items: true, statusChanges: true } });
    expect(order?.items).toHaveLength(1);
    expect(order?.statusChanges).toHaveLength(1);
    expect(await db.event.count({ where: { visitorHash: hashVisitor(ctx("ok")) } })).toBe(1);
    expect((await db.rateLimit.findMany({ where: { key: keyOf("ok") } })).map((r) => r.count)).toEqual([1]);
  });

  it("keeps the counter when the cart is rejected", async () => {
    const nastar = await seeded("Nastar");
    const result = await checkout(db, input(names.ok, nastar.id), ctx("rejected"));
    expect(result).toEqual({ ok: false, error: "rejected", lines: [{ productId: nastar.id, reason: "closed" }] });
    expect((await db.rateLimit.findMany({ where: { key: keyOf("rejected") } })).map((r) => r.count)).toEqual([1]);
  });

  it("keeps the counter when the visitor is rate limited", async () => {
    const windowStart = new Date(Math.floor(now.getTime() / 600_000) * 600_000);
    await db.rateLimit.create({ data: { key: keyOf("limited"), windowStart, count: 5 } });
    const result = await checkout(db, input(names.ok, randomUUID()), ctx("limited"));
    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect((await db.rateLimit.findMany({ where: { key: keyOf("limited") } })).map((r) => r.count)).toEqual([6]);
  });

  it("rolls back everything, the counter included, when a write throws (U+0000 in the name)", async () => {
    const kastengel = await seeded("Kastengel");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await checkout(db, input(`${names.nul}\u0000`, kastengel.id), ctx("nul"));
    spy.mockRestore();
    expect(result).toEqual({ ok: false, error: "server" });
    expect(await db.order.count({ where: { customerName: { startsWith: names.nul } } })).toBe(0);
    expect(await db.event.count({ where: { visitorHash: hashVisitor(ctx("nul")) } })).toBe(0);
    expect(await db.rateLimit.count({ where: { key: keyOf("nul") } })).toBe(0);
  });
});

afterAll(() => db.$disconnect());
