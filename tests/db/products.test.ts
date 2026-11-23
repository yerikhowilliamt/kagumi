// Admin product queries and setProductActive against the development branch (task M3.1 K2, K3, K5, K6), written from
// the M3 plan D9, D13, D14 and exit criterion 4. Every test runs in a transaction that is always rolled back, with a
// fixed `now` (W2): nothing persists. The action's `db` is that transaction while a test runs.
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assertDevelopmentDatabase } from "../../prisma/seed.ts";
import { placeOrder } from "@/lib/checkout";
import { jakartaToday } from "@/lib/order";
import { listProducts, productCounts, setActive, type ProductFilter } from "@/lib/products";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set: tests/db needs the development branch in .env");
}
assertDevelopmentDatabase();

// The session is the gate test's job (tests/admin-actions.test.ts), so requireAdmin passes here; updateTag and
// revalidatePath need a Next request, so they are recorded instead.
const { requireAdmin, updateTag, revalidatePath, state } = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ adminId: "test", sessionId: "test" })),
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
  state: { tx: null as unknown },
}));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("next/cache", () => ({ updateTag, revalidatePath }));
vi.mock("@/lib/db", async (importOriginal) => {
  const real = (await importOriginal<typeof import("@/lib/db")>()).db;
  return {
    db: new Proxy(real, {
      get(target, prop) {
        const client = (state.tx ?? target) as typeof real;
        const value = Reflect.get(client, prop);
        return typeof value === "function" ? value.bind(client) : value;
      },
    }),
  };
});

const { db } = await import("@/lib/db");
const { setProductActive } = await import("@/app/admin/(protected)/produk/actions");

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
const ROLLBACK = new Error("rollback");

/** Runs fn in a transaction that is always rolled back; the action's db is that transaction meanwhile. */
async function rolledBack(fn: (tx: Tx) => Promise<void>) {
  await expect(
    db.$transaction(
      async (tx) => {
        state.tx = tx;
        try {
          await fn(tx);
        } finally {
          state.tx = null;
        }
        throw ROLLBACK;
      },
      // maxWait: opening a Neon connection can take longer than Prisma's 2 s default (P2028, ERR-003).
      { maxWait: 10_000, timeout: 60_000 },
    ),
  ).rejects.toBe(ROLLBACK);
}

// 00:30 WIB on 20 November while UTC is still 19 November: "today" must be the WIB date.
const NOW = new Date("2026-11-19T17:30:00Z");
const TODAY = jakartaToday(NOW);
const YESTERDAY = "2026-11-19";

type Fixture = { type?: "PRE_ORDER" | "READY_STOCK"; isActive?: boolean; sortOrder?: number; deadline?: string | null; price?: number | null };

const product = (tx: Tx, f: Fixture = {}) =>
  tx.product.create({
    data: {
      name: `Test M3.1 ${randomUUID()}`,
      category: "Test",
      type: f.type ?? "READY_STOCK",
      price: f.price ?? null,
      isActive: f.isActive ?? true,
      sortOrder: f.sortOrder ?? 0,
      orderDeadline: f.deadline ? new Date(`${f.deadline}T00:00:00Z`) : null,
    },
  });

const media = (tx: Tx, productId: string, kind: "IMAGE" | "VIDEO") =>
  tx.productMedia.create({
    // Never uploaded: a row only, rolled back.
    data: { productId, publicId: `kagumi/dev/products/test-${randomUUID()}`, kind, version: 1, format: kind === "IMAGE" ? "jpg" : "mp4", width: 10, height: 10, bytes: 1 },
  });

/** The D14 chip counts, straight from SQL. */
const sqlCounts = async (tx: Tx) => {
  const [row] = await tx.$queryRaw<{ all: bigint; ready: bigint; po: bigint; hidden: bigint }[]>`
    SELECT count(*) AS all,
           count(*) FILTER (WHERE type = 'READY_STOCK') AS ready,
           count(*) FILTER (WHERE type = 'PRE_ORDER') AS po,
           count(*) FILTER (WHERE is_active = false) AS hidden
    FROM products`;
  return { all: Number(row.all), READY_STOCK: Number(row.ready), PRE_ORDER: Number(row.po), HIDDEN: Number(row.hidden) };
};

const ids = (rows: { id: string }[], mine: string[]) => rows.map((r) => r.id).filter((id) => mine.includes(id));

describe("productCounts (K2)", { timeout: 120_000 }, () => {
  it("equals count(*) over all products, per type with hidden ones included, and over is_active = false", async () => {
    await rolledBack(async (tx) => {
      const before = await productCounts(tx);
      expect(before).toEqual(await sqlCounts(tx));
      await product(tx, { type: "READY_STOCK", isActive: false });
      await product(tx, { type: "PRE_ORDER", isActive: false });
      await product(tx, { type: "PRE_ORDER" });
      const after = await productCounts(tx);
      expect(after).toEqual(await sqlCounts(tx));
      // The fixtures move each count by what they hold: hidden products count in their type too.
      expect(after).toEqual({ all: before.all + 3, READY_STOCK: before.READY_STOCK + 1, PRE_ORDER: before.PRE_ORDER + 2, HIDDEN: before.HIDDEN + 2 });
    });
  });
});

describe("listProducts (K2, K3)", { timeout: 120_000 }, () => {
  it("orders by sortOrder, then id, and filters by type (hidden included) or by hidden", async () => {
    await rolledBack(async (tx) => {
      const a = await product(tx, { sortOrder: 9001, type: "PRE_ORDER" });
      const b = await product(tx, { sortOrder: 9000, type: "READY_STOCK", isActive: false });
      const c = await product(tx, { sortOrder: 9001, type: "READY_STOCK" });
      const d = await product(tx, { sortOrder: 9000, type: "PRE_ORDER", isActive: false });
      const mine = [a.id, b.id, c.id, d.id];
      const byOrder = (...ps: { id: string; sortOrder: number }[]) =>
        ps.toSorted((x, y) => x.sortOrder - y.sortOrder || (x.id < y.id ? -1 : 1)).map((p) => p.id);

      const list = async (filter: ProductFilter) => ids(await listProducts(tx, filter, TODAY), mine);
      expect(await list(null)).toEqual(byOrder(a, b, c, d));
      expect(await list("READY_STOCK")).toEqual(byOrder(b, c));
      expect(await list("PRE_ORDER")).toEqual(byOrder(a, d));
      expect(await list("HIDDEN")).toEqual(byOrder(b, d));

      // Every listed row matches its filter, not only the fixtures.
      expect((await listProducts(tx, "HIDDEN", TODAY)).every((p) => !p.isActive)).toBe(true);
      expect((await listProducts(tx, "PRE_ORDER", TODAY)).every((p) => p.type === "PRE_ORDER")).toBe(true);
      expect(await listProducts(tx, null, TODAY)).toHaveLength((await sqlCounts(tx)).all);
    });
  });

  it("gives the row fields, the photo and video counts and the closed flag in WIB", async () => {
    await rolledBack(async (tx) => {
      const past = await product(tx, { deadline: YESTERDAY, type: "PRE_ORDER", price: 35000 });
      const today = await product(tx, { deadline: TODAY, type: "PRE_ORDER" });
      const none = await product(tx);
      await media(tx, past.id, "IMAGE");
      await media(tx, past.id, "IMAGE");
      await media(tx, past.id, "VIDEO");
      await media(tx, today.id, "VIDEO");

      const rows = await listProducts(tx, null, TODAY);
      const row = (id: string) => rows.find((r) => r.id === id);
      expect(TODAY).toBe("2026-11-20");
      expect(row(past.id)).toEqual({
        id: past.id,
        name: past.name,
        category: "Test",
        price: 35000,
        type: "PRE_ORDER",
        isActive: true,
        orderDeadline: YESTERDAY,
        closed: true,
        photos: 2,
        videos: 1,
      });
      // The deadline day itself is still open.
      expect(row(today.id)).toMatchObject({ orderDeadline: TODAY, closed: false, photos: 0, videos: 1 });
      expect(row(none.id)).toMatchObject({ orderDeadline: null, closed: false, price: null, photos: 0, videos: 0 });
    });
  });
});

describe("setActive (K5)", { timeout: 120_000 }, () => {
  it("hides and shows a product, reports an unchanged state, and an unknown id as not found", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx);
      expect(await setActive(tx, p.id, false)).toEqual({ found: true, changed: true });
      expect((await tx.product.findUniqueOrThrow({ where: { id: p.id } })).isActive).toBe(false);
      expect(await setActive(tx, p.id, false)).toEqual({ found: true, changed: false });
      expect(await setActive(tx, p.id, true)).toEqual({ found: true, changed: true });
      expect((await tx.product.findUniqueOrThrow({ where: { id: p.id } })).isActive).toBe(true);
      expect(await setActive(tx, randomUUID(), true)).toEqual({ found: false });
    });
  });

  it("exit criterion 4: placeOrder rejects a product hidden by setActive as unavailable", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx, { price: 10000 });
      await setActive(tx, p.id, false);
      const result = await placeOrder(
        tx,
        {
          customerName: "Test M3.1",
          customerPhone: "0812-3456-7890",
          fulfillment: "PICKUP",
          requestedDate: "2026-11-25",
          note: "",
          items: [{ productId: p.id, quantity: 1 }],
        },
        { visitorHash: randomBytes(32).toString("hex"), now: NOW },
      );
      expect(result).toEqual({ ok: false, error: "rejected", lines: [{ productId: p.id, reason: "unavailable" }] });
    });
  });
});

describe("setProductActive (K6, D9, D13)", { timeout: 120_000 }, () => {
  const reset = () => {
    requireAdmin.mockClear();
    updateTag.mockClear();
    revalidatePath.mockClear();
  };

  it("refuses a non-UUID id or a non-boolean with validation and writes nothing", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx);
      const before = await tx.product.findUniqueOrThrow({ where: { id: p.id } });
      reset();
      for (const [id, active] of [
        ["abc", false],
        [`${p.id}x`, false],
        [p.id.replaceAll("-", ""), false],
        [p.id, "false"],
        [p.id, 0],
        [p.id, null],
        [null, false],
      ] as const) {
        expect(await setProductActive(id as string, active as boolean), `${id} ${active}`).toEqual({ ok: false, error: "validation" });
      }
      expect(await tx.product.findUniqueOrThrow({ where: { id: p.id } })).toEqual(before);
      expect(updateTag).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  it("answers not_found for an unknown UUID and revalidates nothing", async () => {
    await rolledBack(async () => {
      reset();
      expect(await setProductActive(randomUUID(), false)).toEqual({ ok: false, error: "not_found" });
      expect(updateTag).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  it("saves the change and expires the products tag and the admin layout; the same state revalidates nothing", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx);
      reset();
      expect(await setProductActive(p.id, false)).toEqual({ ok: true });
      expect(requireAdmin).toHaveBeenCalledTimes(1);
      expect((await tx.product.findUniqueOrThrow({ where: { id: p.id } })).isActive).toBe(false);
      expect(updateTag.mock.calls).toEqual([["products"]]);
      expect(revalidatePath.mock.calls).toEqual([["/admin", "layout"]]);

      reset();
      expect(await setProductActive(p.id, false)).toEqual({ ok: true });
      expect(updateTag).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();

      expect(await setProductActive(p.id, true)).toEqual({ ok: true });
      expect((await tx.product.findUniqueOrThrow({ where: { id: p.id } })).isActive).toBe(true);
      expect(updateTag.mock.calls).toEqual([["products"]]);
    });
  });

  it("returns server on a database error, with one log line holding the error name and code only", async () => {
    const error = Object.assign(new Error("secret product data"), { name: "PrismaClientKnownRequestError", code: "P1001" });
    state.tx = { product: { updateMany: async () => Promise.reject(error) } };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      reset();
      expect(await setProductActive(randomUUID(), true)).toEqual({ ok: false, error: "server" });
      expect(log.mock.calls).toEqual([["[setProductActive] failed", "PrismaClientKnownRequestError", "P1001"]]);
      expect(updateTag).not.toHaveBeenCalled();
    } finally {
      state.tx = null;
      log.mockRestore();
    }
  });
});
