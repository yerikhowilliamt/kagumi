// Admin product queries and actions against the development branch (task M3.1 K2, K3, K5, K6; M3.2 K2–K4), written
// from the M3 plan D9, D12, D13, D14 and exit criterion 4. Every test runs in a transaction that is always rolled back, with a
// fixed `now` (W2): nothing persists. The action's `db` is that transaction while a test runs.
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assertDevelopmentDatabase } from "../../prisma/seed.ts";
import { placeOrder } from "@/lib/checkout";
import { jakartaToday } from "@/lib/order";
import {
  categories,
  deleteProductRow,
  getProduct,
  listProducts,
  nextSortOrder,
  processDeletions,
  productCounts,
  setActive,
  type ProductFilter,
} from "@/lib/products";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set: tests/db needs the development branch in .env");
}
assertDevelopmentDatabase();

// The session is the gate test's job (tests/admin-actions.test.ts), so requireAdmin passes here; updateTag and
// revalidatePath need a Next request, so they are recorded instead.
// destroyAsset is stubbed: no Cloudinary call from npm test (M3.3 task note 5).
const { requireAdmin, updateTag, revalidatePath, destroyAsset, state } = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ adminId: "test", sessionId: "test" })),
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
  destroyAsset: vi.fn<(publicId: string, kind: string) => Promise<"ok" | "not_found">>(async () => "ok"),
  state: { tx: null as unknown },
}));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/cloudinary", () => ({ destroyAsset }));
vi.mock("next/cache", () => ({ updateTag, revalidatePath }));
vi.mock("@/lib/db", async (importOriginal) => {
  const real = (await importOriginal<typeof import("@/lib/db")>()).db;
  return {
    db: new Proxy(real, {
      get(target, prop) {
        // An action's own transaction runs inside the test's rolled-back one.
        if (prop === "$transaction" && state.tx) return (fn: (tx: unknown) => unknown) => fn(state.tx);
        const client = (state.tx ?? target) as typeof real;
        const value = Reflect.get(client, prop);
        return typeof value === "function" ? value.bind(client) : value;
      },
    }),
  };
});

const { db } = await import("@/lib/db");
const { createProduct, deleteProduct, setProductActive, updateProduct } = await import("@/app/admin/(protected)/produk/actions");

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

// M3.2: the product form's queries and actions (M3 plan D9, D12, D13).
const FORM = {
  name: "Test M3.2 Hampers",
  category: "Test",
  description: "  Bolu gulung.  ",
  price: "35.000",
  type: "PRE_ORDER",
  orderDeadline: "2026-12-10",
  isActive: "true",
  sortOrder: "7",
};
function formData(patch: Record<string, string | undefined> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...FORM, ...patch })) if (value !== undefined) form.set(key, value);
  return form;
}

/** The path of a Next redirect error (digest `NEXT_REDIRECT;<type>;<path>;<status>;`). */
async function redirectOf(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return digest.split(";")[2];
    throw error;
  }
  throw new Error("returned without redirecting");
}

const resetMocks = () => {
  destroyAsset.mockReset();
  destroyAsset.mockResolvedValue("ok");
  requireAdmin.mockClear();
  updateTag.mockClear();
  revalidatePath.mockClear();
};

describe("product form queries (K4)", { timeout: 120_000 }, () => {
  it("getProduct gives the form fields with the deadline as YYYY-MM-DD, and null for an unknown id", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx, { deadline: "2026-12-10", price: 35000, type: "PRE_ORDER", isActive: false, sortOrder: 4 });
      expect(await getProduct(tx, p.id)).toEqual({
        id: p.id,
        name: p.name,
        category: "Test",
        description: "",
        price: 35000,
        type: "PRE_ORDER",
        orderDeadline: "2026-12-10",
        isActive: false,
        sortOrder: 4,
      });
      expect(await getProduct(tx, randomUUID())).toBeNull();
    });
  });

  it("categories: every existing category once, sorted as the database sorts; a new one joins the list", async () => {
    await rolledBack(async (tx) => {
      const fresh = `Test M3.2 ${randomBytes(8).toString("hex")}`; // 26 characters: the column holds 40
      await tx.product.create({ data: { name: "Test M3.2 a", category: fresh, type: "PRE_ORDER" } });
      await tx.product.create({ data: { name: "Test M3.2 b", category: fresh, type: "READY_STOCK", isActive: false } });
      const sql = await tx.$queryRaw<{ category: string }[]>`SELECT DISTINCT category FROM products ORDER BY category`;
      const list = await categories(tx);
      expect(list).toEqual(sql.map((row) => row.category));
      expect(list.filter((c) => c === fresh)).toHaveLength(1);
    });
  });

  it("nextSortOrder: the current maximum + 1, capped at 9999", async () => {
    await rolledBack(async (tx) => {
      const [{ max }] = await tx.$queryRaw<{ max: number | null }[]>`SELECT max(sort_order) AS max FROM products`;
      expect(await nextSortOrder(tx)).toBe(max === null ? 0 : Math.min(max + 1, 9999));
      await product(tx, { sortOrder: 9000, isActive: false });
      expect(await nextSortOrder(tx)).toBe(Math.max(9001, Math.min((max ?? -1) + 1, 9999)));
      await product(tx, { sortOrder: 9998, isActive: false });
      expect(await nextSortOrder(tx)).toBe(9999);
      await product(tx, { sortOrder: 12000, isActive: false }); // written outside the form
      expect(await nextSortOrder(tx)).toBe(9999);
    });
  });
});

describe("createProduct (K2, K3, D9, D13)", { timeout: 120_000 }, () => {
  it("writes the row, expires the products tag and the admin layout, and lands on the edit page", async () => {
    await rolledBack(async (tx) => {
      resetMocks();
      const name = `Test M3.2 ${randomUUID()}`;
      const path = await redirectOf(() => createProduct(null, formData({ name })));
      const row = await tx.product.findFirstOrThrow({ where: { name } });
      expect(path).toBe(`/admin/produk/${row.id}`);
      expect(row).toMatchObject({
        category: "Test",
        description: "Bolu gulung.",
        price: 35000,
        type: "PRE_ORDER",
        orderDeadline: new Date("2026-12-10T00:00:00Z"),
        isActive: true,
        sortOrder: 7,
      });
      expect(requireAdmin).toHaveBeenCalledTimes(1);
      expect(updateTag.mock.calls).toEqual([["products"]]);
      expect(revalidatePath.mock.calls).toEqual([["/admin", "layout"]]);

      // Empty price and deadline are null: "Harga via WA", no deadline.
      const plain = `Test M3.2 ${randomUUID()}`;
      await redirectOf(() => createProduct(null, formData({ name: plain, price: "", orderDeadline: "", isActive: "false", type: "READY_STOCK" })));
      expect(await tx.product.findFirstOrThrow({ where: { name: plain } })).toMatchObject({ price: null, orderDeadline: null, isActive: false, type: "READY_STOCK" });
    });
  });

  it("a refused save writes nothing, revalidates nothing, and names each invalid field with its D12 message", async () => {
    await rolledBack(async (tx) => {
      const before = await tx.product.count();
      resetMocks();
      expect(await createProduct(null, formData({ name: "", price: "3,5", orderDeadline: "2026-02-30", sortOrder: "10000" }))).toEqual({
        ok: false,
        error: "validation",
        fields: {
          name: "Isi nama produk (maks. 80 karakter).",
          price: "Isi angka tanpa koma, misalnya 35.000.",
          orderDeadline: "Tanggal tidak valid.",
          sortOrder: "Isi angka 0–9999.",
        },
      });
      expect(await tx.product.count()).toBe(before);
      expect(updateTag).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  it("returns server on a database error, with one log line holding the error name and code only", async () => {
    const error = Object.assign(new Error("secret product data"), { name: "PrismaClientKnownRequestError", code: "P1001" });
    state.tx = { product: { create: async () => Promise.reject(error) } };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      resetMocks();
      expect(await createProduct(null, formData())).toEqual({ ok: false, error: "server" });
      expect(log.mock.calls).toEqual([["[createProduct] failed", "PrismaClientKnownRequestError", "P1001"]]);
      expect(updateTag).not.toHaveBeenCalled();
    } finally {
      state.tx = null;
      log.mockRestore();
    }
  });
});

describe("updateProduct (K2, K3, D9, D13)", { timeout: 120_000 }, () => {
  it("saves every field and expires the products tag and the admin layout", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx, { type: "READY_STOCK", price: 1000 });
      resetMocks();
      const name = `Test M3.2 ${randomUUID()}`;
      expect(await updateProduct(null, formData({ id: p.id, name, price: "40.000", orderDeadline: "2020-01-01", isActive: "false" }))).toEqual({ ok: true });
      expect(await getProduct(tx, p.id)).toEqual({
        id: p.id,
        name,
        category: "Test",
        description: "Bolu gulung.",
        price: 40000,
        type: "PRE_ORDER",
        orderDeadline: "2020-01-01", // a past date closes the pre-order at once (PRD §5)
        isActive: false,
        sortOrder: 7,
      });
      expect(requireAdmin).toHaveBeenCalledTimes(1);
      expect(updateTag.mock.calls).toEqual([["products"]]);
      expect(revalidatePath.mock.calls).toEqual([["/admin", "layout"]]);
    });
  });

  it("a refused save leaves the row as it was and revalidates nothing", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx, { price: 1000 });
      const before = await tx.product.findUniqueOrThrow({ where: { id: p.id } });
      resetMocks();
      expect(await updateProduct(null, formData({ id: p.id, category: "k".repeat(41), description: "d".repeat(501) }))).toEqual({
        ok: false,
        error: "validation",
        fields: { category: "Isi kategori (maks. 40 karakter).", description: "Deskripsi maks. 500 karakter." },
      });
      expect(await tx.product.findUniqueOrThrow({ where: { id: p.id } })).toEqual(before);
      expect(updateTag).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  it("refuses an id that is not a UUID with validation before any database read", async () => {
    const reads: string[] = [];
    state.tx = new Proxy({}, { get: (_target, prop) => void reads.push(String(prop)) });
    try {
      resetMocks();
      for (const id of [undefined, "", "abc", "-".repeat(36), `${randomUUID()}x`]) {
        expect(await updateProduct(null, formData({ id })), String(id)).toEqual({ ok: false, error: "validation" });
      }
      expect(reads).toEqual([]);
      expect(updateTag).not.toHaveBeenCalled();
    } finally {
      state.tx = null;
    }
  });

  it("answers not_found for an unknown UUID and revalidates nothing", async () => {
    await rolledBack(async () => {
      resetMocks();
      expect(await updateProduct(null, formData({ id: randomUUID() }))).toEqual({ ok: false, error: "not_found" });
      expect(updateTag).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  it("returns server on a database error, with one log line holding the error name and code only", async () => {
    const error = Object.assign(new Error("secret product data"), { name: "PrismaClientKnownRequestError", code: "P1001" });
    state.tx = { product: { updateMany: async () => Promise.reject(error) } };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      resetMocks();
      expect(await updateProduct(null, formData({ id: randomUUID() }))).toEqual({ ok: false, error: "server" });
      expect(log.mock.calls).toEqual([["[updateProduct] failed", "PrismaClientKnownRequestError", "P1001"]]);
      expect(updateTag).not.toHaveBeenCalled();
    } finally {
      state.tx = null;
      log.mockRestore();
    }
  });
});

// M3.3 K5, exit criterion 3 (M3 plan D4, FR27, ERD set-null): the queue rows are written with the delete, before any
// destroy; a destroyed asset leaves the queue, a failed one stays with attempts + 1 and its error; past orders keep
// the name and price.
describe("delete through the queue (M3.3 K5, exit criterion 3)", { timeout: 120_000 }, () => {
  /** A product with an image, a video, one order line and one event. */
  async function deletable(tx: Tx) {
    const p = await product(tx, { price: 35000 });
    const assets = [await media(tx, p.id, "IMAGE"), await media(tx, p.id, "VIDEO")].map((m) => ({ publicId: m.publicId, kind: m.kind }));
    const order = await tx.order.create({
      data: {
        id: -9_000_000 - Math.floor(Math.random() * 1_000_000), // negative: never collides with real orders
        customerName: "Test M3.3",
        customerPhone: "6280000000000",
        fulfillment: "PICKUP",
        requestedDate: new Date("2026-11-25T00:00:00Z"),
        items: { create: { productId: p.id, productName: p.name, unitPrice: 35000, quantity: 2 } },
      },
      select: { id: true },
    });
    const event = await tx.event.create({ data: { type: "PRODUCT_VIEW", productId: p.id, visitorHash: "0".repeat(64) }, select: { id: true } });
    return { p, assets, orderId: order.id, eventId: event.id };
  }
  const queue = (tx: Tx, assets: { publicId: string }[]) =>
    tx.pendingDeletion.findMany({ where: { publicId: { in: assets.map((a) => a.publicId) } }, orderBy: { publicId: "asc" } });

  it("queues every medium and deletes the product in one step; order lines and events keep their rows", async () => {
    await rolledBack(async (tx) => {
      const { p, assets, orderId, eventId } = await deletable(tx);
      const destroy = vi.fn();
      const queued = await deleteProductRow(tx, p.id);
      expect(queued?.toSorted((a, b) => a.publicId.localeCompare(b.publicId))).toEqual(assets.toSorted((a, b) => a.publicId.localeCompare(b.publicId)));
      // The function could stop here: both assets are on record, nothing destroyed yet.
      expect(destroy).not.toHaveBeenCalled();
      const rows = await queue(tx, assets);
      expect(rows.map((r) => [r.publicId, r.kind, r.attempts, r.lastError])).toEqual(
        assets.toSorted((a, b) => a.publicId.localeCompare(b.publicId)).map((a) => [a.publicId, a.kind, 0, null]),
      );
      expect(await tx.product.count({ where: { id: p.id } })).toBe(0);
      expect(await tx.productMedia.count({ where: { productId: p.id } })).toBe(0);
      const [line] = await tx.orderItem.findMany({ where: { orderId } });
      expect(line).toMatchObject({ productId: null, productName: p.name, unitPrice: 35000, quantity: 2 });
      expect(await tx.event.findUnique({ where: { id: eventId } })).toMatchObject({ productId: null, type: "PRODUCT_VIEW" });
    });
  });

  it("a product with no media queues nothing; an unknown id is null and writes nothing", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx);
      const before = await tx.pendingDeletion.count();
      expect(await deleteProductRow(tx, p.id)).toEqual([]);
      expect(await deleteProductRow(tx, randomUUID())).toBeNull();
      expect(await tx.pendingDeletion.count()).toBe(before);
    });
  });

  it("processDeletions: every destroy succeeds → no queue row left", async () => {
    await rolledBack(async (tx) => {
      const { p, assets } = await deletable(tx);
      const queued = (await deleteProductRow(tx, p.id))!;
      const destroy = vi.fn(async () => "ok" as const);
      expect(await processDeletions(tx, queued, destroy)).toBe(0);
      expect(destroy.mock.calls.toSorted()).toEqual(assets.map((a) => [a.publicId, a.kind]).toSorted());
      expect(await queue(tx, assets)).toEqual([]);
    });
  });

  it("processDeletions: one destroy fails → its row stays with attempts 1 and last_error, the other is gone", async () => {
    await rolledBack(async (tx) => {
      const { p, assets } = await deletable(tx);
      const queued = (await deleteProductRow(tx, p.id))!;
      const [bad] = assets;
      const destroy = vi.fn(async (publicId: string) => {
        if (publicId === bad.publicId) throw new Error("Cloudinary destroy: HTTP 500: General Error");
        return "not_found" as const; // already gone counts as done
      });
      expect(await processDeletions(tx, queued, destroy)).toBe(1);
      const rows = await queue(tx, assets);
      expect(rows.map((r) => [r.publicId, r.attempts, r.lastError])).toEqual([[bad.publicId, 1, "Cloudinary destroy: HTTP 500: General Error"]]);
      // A second failure counts up; last_error is capped at the column's 500 characters.
      await processDeletions(tx, [bad], async () => Promise.reject(new Error("x".repeat(600))));
      expect(await queue(tx, [bad])).toMatchObject([{ attempts: 2, lastError: "x".repeat(500) }]);
    });
  });

  it("deleteProduct: queue, destroy, D9, then the products list", async () => {
    await rolledBack(async (tx) => {
      resetMocks();
      const { p, assets, orderId } = await deletable(tx);
      expect(await redirectOf(() => deleteProduct(p.id))).toBe("/admin/produk");
      expect(requireAdmin).toHaveBeenCalledTimes(1);
      expect(destroyAsset.mock.calls.toSorted()).toEqual(assets.map((a) => [a.publicId, a.kind]).toSorted());
      expect(await queue(tx, assets)).toEqual([]);
      expect(await tx.product.count({ where: { id: p.id } })).toBe(0);
      expect(await tx.orderItem.findFirst({ where: { orderId } })).toMatchObject({ productId: null, productName: p.name, unitPrice: 35000 });
      expect(updateTag).toHaveBeenCalledWith("products");
      expect(revalidatePath).toHaveBeenCalledWith("/admin", "layout");
    });
  });

  it("deleteProduct: a failed destroy still deletes the product and leaves the asset queued, with one log line", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await rolledBack(async (tx) => {
        resetMocks();
        const { p, assets } = await deletable(tx);
        destroyAsset.mockRejectedValue(new Error("Cloudinary destroy: network error"));
        expect(await redirectOf(() => deleteProduct(p.id))).toBe("/admin/produk");
        expect(await queue(tx, assets)).toMatchObject(assets.map(() => ({ attempts: 1, lastError: "Cloudinary destroy: network error" })));
        expect(await tx.product.count({ where: { id: p.id } })).toBe(0);
        expect(log.mock.calls).toEqual([["[deleteProduct] destroy failed, left in pending_deletions:", 2]]);
        expect(updateTag).toHaveBeenCalledWith("products");
      });
    } finally {
      log.mockRestore();
    }
  });

  it("deleteProduct: not_found for an unknown id, validation before any database read", async () => {
    await rolledBack(async () => {
      resetMocks();
      expect(await deleteProduct(randomUUID())).toEqual({ ok: false, error: "not_found" });
      expect(updateTag).not.toHaveBeenCalled();
      expect(destroyAsset).not.toHaveBeenCalled();
    });
    const reads: string[] = [];
    state.tx = new Proxy({}, { get: (_target, prop) => void reads.push(String(prop)) });
    try {
      resetMocks();
      for (const id of [undefined, "", "abc", "-".repeat(36), `${randomUUID()}x`, 42]) {
        expect(await deleteProduct(id as string), String(id)).toEqual({ ok: false, error: "validation" });
      }
      expect(reads).toEqual([]);
    } finally {
      state.tx = null;
    }
  });

  it("deleteProduct: server on a database error, with one log line holding the error name and code only", async () => {
    const error = Object.assign(new Error("secret product data"), { name: "PrismaClientKnownRequestError", code: "P1001" });
    state.tx = { $queryRaw: async () => Promise.reject(error) };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      resetMocks();
      expect(await deleteProduct(randomUUID())).toEqual({ ok: false, error: "server" });
      expect(log.mock.calls).toEqual([["[deleteProduct] failed", "PrismaClientKnownRequestError", "P1001"]]);
      expect(updateTag).not.toHaveBeenCalled();
    } finally {
      state.tx = null;
      log.mockRestore();
    }
  });
});
