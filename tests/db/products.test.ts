// Admin product queries and actions against the development branch (task M3.1 K2, K3, K5, K6; M3.2 K2–K4; M3.3 K5;
// M3.4 K3, K4), written from the M3 plan D4, D9–D14, D16 and exit criteria 2–4. Every test runs in a transaction that
// is always rolled back, with a fixed `now` (W2): nothing persists. The action's `db` is that transaction while a test
// runs. The one exception is the M3.4 barrier test, which commits one product "Test M3 …" with media rows that were
// never uploaded and deletes it at the end.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { assertDevelopmentDatabase } from "../../prisma/seed.ts";
import { placeOrder } from "@/lib/checkout";
import { jakartaToday } from "@/lib/order";
import { signParams } from "@/lib/cloudinary";
import {
  addMediaRow,
  categories,
  deleteMediaRow,
  deleteProductRow,
  getProduct,
  listMedia,
  listProducts,
  moveRow,
  nextSortOrder,
  processDeletions,
  productCounts,
  setActive,
  setMainRow,
  type NewMedia,
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
// Signing, verification and the upload check stay real (M3.4 K3); only the destroy is stubbed.
vi.mock("@/lib/cloudinary", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/cloudinary")>()), destroyAsset }));
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
const { addProductMedia, createProduct, deleteMedia, deleteProduct, getUploadSignature, moveMedia, setMainMedia, setProductActive, updateProduct } = await import(
  "@/app/admin/(protected)/produk/actions"
);

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

  it("gives the row fields, the media in display order, the photo and video counts and the closed flag in WIB", async () => {
    await rolledBack(async (tx) => {
      const past = await product(tx, { deadline: YESTERDAY, type: "PRE_ORDER", price: 35000 });
      const today = await product(tx, { deadline: TODAY, type: "PRE_ORDER" });
      const none = await product(tx);
      const first = await media(tx, past.id, "IMAGE");
      const main = await media(tx, past.id, "IMAGE");
      const clip = await media(tx, past.id, "VIDEO");
      await media(tx, today.id, "VIDEO");
      // Display order (D11, M3.5 list thumb): the main one, then by sortOrder.
      await tx.productMedia.update({ where: { id: first.id }, data: { sortOrder: 2 } });
      await tx.productMedia.update({ where: { id: main.id }, data: { sortOrder: 5, isMain: true } });
      await tx.productMedia.update({ where: { id: clip.id }, data: { sortOrder: 1 } });

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
        media: [main, clip, first].map(({ kind, publicId, version }) => ({ kind, publicId, version })),
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

  it("an asset already queued keeps its row and doesn't block the delete (BSA-M3.3-01)", async () => {
    await rolledBack(async (tx) => {
      const { p, assets } = await deletable(tx);
      const [old] = assets;
      await tx.pendingDeletion.create({ data: { publicId: old.publicId, kind: old.kind, attempts: 3, lastError: "HTTP 500: earlier" } });
      const queued = await deleteProductRow(tx, p.id);
      expect(queued).toHaveLength(2);
      expect(await tx.product.count({ where: { id: p.id } })).toBe(0);
      const rows = await queue(tx, assets);
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.publicId === old.publicId)).toMatchObject({ attempts: 3, lastError: "HTTP 500: earlier" });
    });
  });

  it("processDeletions destroys one asset at a time, in the queued order (decision 5, BSA-M3.3-03)", async () => {
    await rolledBack(async (tx) => {
      const { p } = await deletable(tx);
      const queued = (await deleteProductRow(tx, p.id))!;
      const events: string[] = [];
      let inFlight = 0;
      let peak = 0;
      await processDeletions(tx, queued, async (publicId) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        events.push(`start ${publicId}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push(`end ${publicId}`);
        inFlight -= 1;
        return "ok";
      });
      expect(peak).toBe(1);
      expect(events).toEqual(queued.flatMap((a) => [`start ${a.publicId}`, `end ${a.publicId}`]));
    });
  });

  it("deleteProduct: a database error after the commit is logged, and the delete still revalidates and redirects (BSA-M3.3-03)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await rolledBack(async (tx) => {
        resetMocks();
        const { p } = await deletable(tx);
        const error = Object.assign(new Error("secret product data"), { name: "PrismaClientKnownRequestError", code: "P1001" });
        // The queue clean-up fails; the delete transaction itself (createMany, delete) works.
        state.tx = new Proxy(tx, {
          get(target, prop) {
            const value = Reflect.get(target, prop);
            if (prop !== "pendingDeletion") return typeof value === "function" ? value.bind(target) : value;
            return new Proxy(value, {
              get: (delegate, method) => (method === "deleteMany" ? async () => Promise.reject(error) : Reflect.get(delegate, method)),
            });
          },
        });
        expect(await redirectOf(() => deleteProduct(p.id))).toBe("/admin/produk");
        expect(destroyAsset).toHaveBeenCalledTimes(1); // stopped at the first queue clean-up
        expect(log.mock.calls).toEqual([["[deleteProduct] failed", "PrismaClientKnownRequestError", "P1001"]]);
        expect(updateTag).toHaveBeenCalledWith("products");
        expect(revalidatePath).toHaveBeenCalledWith("/admin", "layout");
        expect(await tx.product.count({ where: { id: p.id } })).toBe(0);
      });
    } finally {
      log.mockRestore();
    }
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

// M3.4 media (K3, K4; exit criterion 2): D11 rules, the D16 server check and D4 for every failure after the upload.
describe("media rules (M3.4 K4, D11)", { timeout: 120_000 }, () => {
  const asset = (kind: "IMAGE" | "VIDEO"): NewMedia => ({
    publicId: `kagumi/dev/products/test-${randomUUID()}`,
    kind,
    version: 1,
    format: kind === "IMAGE" ? "jpg" : "mp4",
    width: 10,
    height: 10,
    bytes: 1,
    durationSec: kind === "VIDEO" ? 2 : null,
  });
  /** [kind, isMain] per medium in display order, with their ids. */
  const shown = async (tx: Tx, productId: string) => (await listMedia(tx, productId)).map((m) => ({ id: m.id, kind: m.kind, isMain: m.isMain }));
  const added = async (tx: Tx, productId: string, kind: "IMAGE" | "VIDEO") => {
    const row = await addMediaRow(tx, productId, asset(kind));
    if (typeof row === "string") throw new Error(row);
    return row;
  };

  it("a new medium gets max + 1; the first image becomes main by itself, a video never, later images not", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx);
      const video = await added(tx, p.id, "VIDEO");
      expect(video).toMatchObject({ isMain: false, sortOrder: 0, durationSec: 2 });
      const first = await added(tx, p.id, "IMAGE");
      expect(first).toMatchObject({ isMain: true, sortOrder: 1 });
      const second = await added(tx, p.id, "IMAGE");
      expect(second).toMatchObject({ isMain: false, sortOrder: 2 });
      // Display order: the main one first, then sortOrder.
      expect((await shown(tx, p.id)).map((m) => m.id)).toEqual([first.id, video.id, second.id]);
    });
  });

  it("addMediaRow: not_found for an unknown product, duplicate for a public_id already saved; neither writes a row", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx);
      expect(await addMediaRow(tx, randomUUID(), asset("IMAGE"))).toBe("not_found");
      const a = asset("IMAGE");
      await addMediaRow(tx, p.id, a);
      expect(await addMediaRow(tx, p.id, { ...a, version: 2 })).toBe("duplicate");
      expect(await tx.productMedia.count({ where: { publicId: a.publicId } })).toBe(1);
    });
  });

  it("setMainRow moves the flag between images in one step; a video can't be main; another product's medium is not found", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx);
      const other = await product(tx);
      const first = await added(tx, p.id, "IMAGE");
      const video = await added(tx, p.id, "VIDEO");
      const second = await added(tx, p.id, "IMAGE");
      expect(await setMainRow(tx, p.id, second.id)).toBe("ok");
      expect(await shown(tx, p.id)).toEqual([
        { id: second.id, kind: "IMAGE", isMain: true },
        { id: first.id, kind: "IMAGE", isMain: false },
        { id: video.id, kind: "VIDEO", isMain: false },
      ]);
      expect(await setMainRow(tx, p.id, second.id)).toBe("unchanged");
      expect(await setMainRow(tx, p.id, video.id)).toBe("video");
      expect(await setMainRow(tx, other.id, first.id)).toBe("not_found");
      expect(await setMainRow(tx, randomUUID(), first.id)).toBe("not_found");
      expect((await shown(tx, p.id)).filter((m) => m.isMain).map((m) => m.id)).toEqual([second.id]);
    });
  });

  it("moveRow swaps with the neighbour after the main one; the main one and the ends can't move", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx);
      const main = await added(tx, p.id, "IMAGE");
      const a = await added(tx, p.id, "VIDEO");
      const b = await added(tx, p.id, "IMAGE");
      const c = await added(tx, p.id, "IMAGE");
      const order = async () => (await shown(tx, p.id)).map((m) => m.id);
      expect(await moveRow(tx, p.id, c.id, "left")).toBe("ok");
      expect(await order()).toEqual([main.id, a.id, c.id, b.id]);
      expect(await moveRow(tx, p.id, a.id, "right")).toBe("ok");
      expect(await order()).toEqual([main.id, c.id, a.id, b.id]);
      expect(await moveRow(tx, p.id, main.id, "right")).toBe("invalid");
      expect(await moveRow(tx, p.id, c.id, "left")).toBe("invalid");
      expect(await moveRow(tx, p.id, b.id, "right")).toBe("invalid");
      expect(await moveRow(tx, p.id, randomUUID(), "left")).toBe("not_found");
      expect(await order()).toEqual([main.id, c.id, a.id, b.id]);
    });
  });

  it("moveRow still swaps when two media share a sortOrder", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx);
      await added(tx, p.id, "IMAGE");
      const a = await added(tx, p.id, "VIDEO");
      const b = await added(tx, p.id, "VIDEO");
      await tx.productMedia.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { sortOrder: 5 } });
      const [, first, second] = await shown(tx, p.id);
      expect(await moveRow(tx, p.id, second.id, "left")).toBe("ok");
      expect((await shown(tx, p.id)).slice(1).map((m) => m.id)).toEqual([second.id, first.id]);
    });
  });

  it("setMainRow after moves leaves no shared sortOrder: the order is total, as the storefront needs (BSA-M3.4-02)", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx);
      const m = await added(tx, p.id, "IMAGE");
      const a = await added(tx, p.id, "IMAGE");
      const b = await added(tx, p.id, "IMAGE");
      const c = await added(tx, p.id, "IMAGE");
      expect(await moveRow(tx, p.id, c.id, "left")).toBe("ok"); // a 0, c 1, b 2; m (main) keeps 0
      expect(await setMainRow(tx, p.id, b.id)).toBe("ok");
      const rows = await listMedia(tx, p.id);
      expect(rows.map((r) => r.id)).toEqual([b.id, m.id, a.id, c.id]);
      expect(rows.filter((r) => !r.isMain).map((r) => r.sortOrder)).toEqual([0, 1, 2]);
    });
  });

  it("deleting the main photo promotes the next image in display order after moves, not in creation order (BSA-M3.4-04)", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx);
      const m = await added(tx, p.id, "IMAGE");
      const v = await added(tx, p.id, "VIDEO");
      const a = await added(tx, p.id, "IMAGE");
      const b = await added(tx, p.id, "IMAGE");
      await moveRow(tx, p.id, b.id, "left");
      await moveRow(tx, p.id, b.id, "left"); // b, v, a
      await moveRow(tx, p.id, v.id, "left"); // v, b, a
      await deleteMediaRow(tx, p.id, m.id);
      expect(await shown(tx, p.id)).toEqual([
        { id: b.id, kind: "IMAGE", isMain: true },
        { id: v.id, kind: "VIDEO", isMain: false },
        { id: a.id, kind: "IMAGE", isMain: false },
      ]);
    });
  });

  it("deleteMediaRow queues the asset; deleting the main photo makes the next image main; no image left → no main", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx);
      const main = await added(tx, p.id, "IMAGE");
      const video = await added(tx, p.id, "VIDEO");
      const next = await added(tx, p.id, "IMAGE");
      expect(await deleteMediaRow(tx, p.id, main.id)).toEqual({ publicId: main.publicId, kind: "IMAGE" });
      expect(await tx.pendingDeletion.findUnique({ where: { publicId: main.publicId } })).toMatchObject({ kind: "IMAGE", attempts: 0 });
      // The video came before the next image in sortOrder; only an image can be main.
      expect(await shown(tx, p.id)).toEqual([
        { id: next.id, kind: "IMAGE", isMain: true },
        { id: video.id, kind: "VIDEO", isMain: false },
      ]);
      await deleteMediaRow(tx, p.id, next.id);
      expect(await shown(tx, p.id)).toEqual([{ id: video.id, kind: "VIDEO", isMain: false }]);
      expect(await deleteMediaRow(tx, p.id, randomUUID())).toBeNull();
      expect(await deleteMediaRow(tx, (await product(tx)).id, video.id)).toBeNull();
      expect(await tx.productMedia.count({ where: { id: video.id } })).toBe(1);
    });
  });
});

describe("media actions (M3.4 K3, D4, D9, D16; exit criterion 2)", { timeout: 120_000 }, () => {
  const SECRET = "test-secret-not-real";
  const stubKeys = () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "test-cloud");
    vi.stubEnv("CLOUDINARY_API_KEY", "test-key");
    vi.stubEnv("CLOUDINARY_API_SECRET", SECRET);
    vi.stubEnv("VERCEL_ENV", "");
  };
  /** A Cloudinary upload response, signed as Cloudinary signs it (C4, SHA-1 as W5 saw). */
  const response = (fields: Record<string, unknown> = {}) => {
    const r = {
      public_id: `kagumi/dev/products/test-${randomUUID()}`,
      version: 1732400000,
      resource_type: "image",
      format: "jpg",
      bytes: 1000,
      width: 160,
      height: 200,
      duration: null as number | null,
      ...fields,
    };
    return { ...r, signature: signParams({ public_id: r.public_id, version: r.version }, SECRET, "sha1") };
  };
  const queued = (tx: Tx, publicId: string) => tx.pendingDeletion.count({ where: { publicId } });
  const inAction = async (fn: () => Promise<void>) => {
    stubKeys();
    try {
      await fn();
    } finally {
      vi.unstubAllEnvs();
    }
  };

  it("saves a verified upload: the row, D9, and nothing queued or destroyed", async () => {
    await inAction(() =>
      rolledBack(async (tx) => {
        resetMocks();
        const p = await product(tx);
        const r = response();
        const result = await addProductMedia(p.id, { ...r, extra: "dropped" });
        expect(result).toMatchObject({ ok: true, media: { publicId: r.public_id, kind: "IMAGE", isMain: true, format: "jpg", bytes: 1000, durationSec: null } });
        expect(requireAdmin).toHaveBeenCalledTimes(1);
        expect(updateTag).toHaveBeenCalledWith("products");
        expect(revalidatePath).toHaveBeenCalledWith("/admin", "layout");
        expect(destroyAsset).not.toHaveBeenCalled();
        expect(await queued(tx, r.public_id)).toBe(0);
        const video = response({ resource_type: "video", format: "mp4", duration: 2.5 });
        expect(await addProductMedia(p.id, video)).toMatchObject({ ok: true, media: { kind: "VIDEO", isMain: false, durationSec: 2.5 } });
      }),
    );
  });

  it("K3: bytes, format, duration or folder out of rule → no row, the public_id queued, the destroy called, limit with the reason", async () => {
    const MiB = 1024 * 1024;
    const cases: [Record<string, unknown>, string, "IMAGE" | "VIDEO"][] = [
      [{ bytes: 10 * MiB + 1 }, "size", "IMAGE"],
      [{ resource_type: "video", format: "mp4", bytes: 50 * MiB + 1, duration: 5 }, "size", "VIDEO"],
      [{ format: "gif" }, "format", "IMAGE"],
      [{ resource_type: "video", format: "mp4", duration: 30.5 }, "duration", "VIDEO"],
      [{ public_id: `kagumi/products/test-${randomUUID()}` }, "folder", "IMAGE"],
      [{ public_id: `elsewhere/test-${randomUUID()}` }, "folder", "IMAGE"],
    ];
    await inAction(() =>
      rolledBack(async (tx) => {
        const p = await product(tx);
        for (const [fields, reason, kind] of cases) {
          resetMocks();
          destroyAsset.mockResolvedValue("not_found"); // a stub fetch: done, so the queue row is cleared
          const r = response(fields);
          expect(await addProductMedia(p.id, r), reason).toEqual({ ok: false, error: "limit", reason });
          expect(destroyAsset.mock.calls, reason).toEqual([[r.public_id, kind]]);
          expect(await tx.productMedia.count({ where: { productId: p.id } }), reason).toBe(0);
          expect(updateTag).not.toHaveBeenCalled();
        }
        // A failed destroy leaves the queue row for the cron.
        resetMocks();
        destroyAsset.mockRejectedValue(new Error("Cloudinary destroy: HTTP 500"));
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const r = response({ bytes: 10 * MiB + 1 });
        try {
          expect(await addProductMedia(p.id, r)).toEqual({ ok: false, error: "limit", reason: "size" });
        } finally {
          log.mockRestore();
        }
        expect(await tx.pendingDeletion.findUnique({ where: { publicId: r.public_id } })).toMatchObject({ attempts: 1, lastError: "Cloudinary destroy: HTTP 500" });
      }),
    );
  });

  it("K3: a forged signature → validation, nothing saved, queued or destroyed; so is a malformed body", async () => {
    await inAction(() =>
      rolledBack(async (tx) => {
        resetMocks();
        const p = await product(tx);
        const r = response();
        const forged = [
          { ...r, signature: "0".repeat(40) },
          { ...r, version: r.version + 1 }, // the signature no longer covers it
          { ...r, public_id: `${r.public_id}x` },
          { ...r, signature: signParams({ public_id: r.public_id, version: r.version }, "another-secret", "sha1") },
        ];
        for (const body of [...forged, null, "x", { ...r, bytes: "1000" }, { ...r, version: 1.5 }, { ...r, public_id: "" }]) {
          expect(await addProductMedia(p.id, body), JSON.stringify(body)).toEqual({ ok: false, error: "validation" });
        }
        expect(await addProductMedia("abc", r)).toEqual({ ok: false, error: "validation" });
        expect(destroyAsset).not.toHaveBeenCalled();
        expect(await tx.productMedia.count({ where: { productId: p.id } })).toBe(0);
        expect(await queued(tx, r.public_id)).toBe(0);
        expect(updateTag).not.toHaveBeenCalled();
      }),
    );
  });

  it("K3: an unknown product → not_found and the asset goes through D4; a public_id already saved → validation, not destroyed", async () => {
    await inAction(() =>
      rolledBack(async (tx) => {
        resetMocks();
        const r = response();
        expect(await addProductMedia(randomUUID(), r)).toEqual({ ok: false, error: "not_found" });
        expect(destroyAsset.mock.calls).toEqual([[r.public_id, "IMAGE"]]);
        expect(await queued(tx, r.public_id)).toBe(0); // destroyed, so its queue row is gone

        resetMocks();
        const p = await product(tx);
        const saved = response();
        expect(await addProductMedia(p.id, saved)).toMatchObject({ ok: true });
        resetMocks();
        expect(await addProductMedia(p.id, saved)).toEqual({ ok: false, error: "validation" });
        expect(destroyAsset).not.toHaveBeenCalled();
        expect(await tx.productMedia.count({ where: { publicId: saved.public_id } })).toBe(1);
        expect(updateTag).not.toHaveBeenCalled();
      }),
    );
  });

  it("a saved public_id is never destroyed: sent to a missing product or out of rule, it gets validation (BSA-M3.4-01)", async () => {
    await inAction(() =>
      rolledBack(async (tx) => {
        resetMocks();
        const p = await product(tx);
        const saved = response();
        expect(await addProductMedia(p.id, saved)).toMatchObject({ ok: true });
        resetMocks();
        const tooBig = { ...saved, bytes: 10 * 1024 * 1024 + 1 };
        tooBig.signature = signParams({ public_id: saved.public_id, version: saved.version }, SECRET, "sha1");
        expect(await addProductMedia(randomUUID(), saved)).toEqual({ ok: false, error: "validation" });
        expect(await addProductMedia(p.id, tooBig)).toEqual({ ok: false, error: "validation" });
        expect(destroyAsset).not.toHaveBeenCalled();
        expect(await queued(tx, saved.public_id)).toBe(0);
        expect(await tx.productMedia.count({ where: { publicId: saved.public_id } })).toBe(1);
      }),
    );
  });

  it("getUploadSignature signs exactly allowed_formats, folder and timestamp with the six formats, and returns no secret (BSA-M3.4-03)", async () => {
    await inAction(async () => {
      requireAdmin.mockClear();
      const before = Math.floor(Date.now() / 1000);
      const result = await getUploadSignature();
      if (!result.ok) throw new Error("no signature");
      expect(requireAdmin).toHaveBeenCalledTimes(1);
      expect(Object.keys(result).sort()).toEqual(["allowedFormats", "apiKey", "cloudName", "folder", "ok", "signature", "timestamp"]);
      expect(result).toMatchObject({ cloudName: "test-cloud", apiKey: "test-key", folder: "kagumi/dev/products" });
      expect(result.allowedFormats.split(",").sort()).toEqual(["heic", "jpg", "mov", "mp4", "png", "webp"]);
      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.signature).toBe(signParams({ allowed_formats: result.allowedFormats, folder: result.folder, timestamp: result.timestamp }, SECRET));
      expect(result.signature).toMatch(/^[0-9a-f]{64}$/); // SHA-256 (System Design §4.5)
      expect(JSON.stringify(result)).not.toContain(SECRET);
    });
  });

  it("a database error after the verification → server, one log line with name and code, and the asset through D4", async () => {
    const error = Object.assign(new Error("secret product data"), { name: "PrismaClientKnownRequestError", code: "P1001" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await inAction(() =>
      rolledBack(async (tx) => {
        resetMocks();
        const p = await product(tx);
        state.tx = new Proxy(tx, {
          get(target, prop) {
            const value = Reflect.get(target, prop);
            if (prop !== "productMedia") return typeof value === "function" ? value.bind(target) : value;
            return new Proxy(value, { get: (delegate, method) => (method === "create" ? async () => Promise.reject(error) : Reflect.get(delegate, method)) });
          },
        });
        const r = response();
        try {
          expect(await addProductMedia(p.id, r)).toEqual({ ok: false, error: "server" });
          expect(log.mock.calls).toEqual([["[addProductMedia] failed", "PrismaClientKnownRequestError", "P1001"]]);
        } finally {
          state.tx = tx;
          log.mockRestore();
        }
        expect(destroyAsset.mock.calls).toEqual([[r.public_id, "IMAGE"]]);
        expect(updateTag).not.toHaveBeenCalled();
      }),
    );
  });

  it("setMainMedia, moveMedia, deleteMedia: D9 on a change; validation for a video, the main one, an end or a bad id; not_found", async () => {
    await rolledBack(async (tx) => {
      const p = await product(tx);
      const main = await media(tx, p.id, "IMAGE");
      await tx.productMedia.update({ where: { id: main.id }, data: { isMain: true } });
      const video = await media(tx, p.id, "VIDEO");
      const photo = await tx.productMedia.update({ where: { id: (await media(tx, p.id, "IMAGE")).id }, data: { sortOrder: 1 } });

      resetMocks();
      expect(await setMainMedia(p.id, video.id)).toEqual({ ok: false, error: "validation" });
      expect(await moveMedia(p.id, main.id, "left")).toEqual({ ok: false, error: "validation" });
      expect(await moveMedia(p.id, video.id, "left")).toEqual({ ok: false, error: "validation" });
      expect(await moveMedia(p.id, video.id, "up" as "left")).toEqual({ ok: false, error: "validation" });
      expect(await setMainMedia(p.id, "abc")).toEqual({ ok: false, error: "validation" });
      expect(await deleteMedia("abc", video.id)).toEqual({ ok: false, error: "validation" });
      expect(await setMainMedia(p.id, randomUUID())).toEqual({ ok: false, error: "not_found" });
      expect(await moveMedia(randomUUID(), video.id, "right")).toEqual({ ok: false, error: "not_found" });
      expect(await deleteMedia(p.id, randomUUID())).toEqual({ ok: false, error: "not_found" });
      expect(await setMainMedia(p.id, main.id)).toEqual({ ok: true }); // already main: nothing to revalidate
      expect(updateTag).not.toHaveBeenCalled();
      expect(destroyAsset).not.toHaveBeenCalled();

      expect(await moveMedia(p.id, video.id, "right")).toEqual({ ok: true });
      expect(updateTag).toHaveBeenCalledWith("products");
      expect(revalidatePath).toHaveBeenCalledWith("/admin", "layout");
      expect((await listMedia(tx, p.id)).map((m) => m.id)).toEqual([main.id, photo.id, video.id]);

      resetMocks();
      expect(await setMainMedia(p.id, photo.id)).toEqual({ ok: true });
      expect(updateTag).toHaveBeenCalledWith("products");
      expect((await listMedia(tx, p.id)).filter((m) => m.isMain).map((m) => m.id)).toEqual([photo.id]);

      resetMocks();
      expect(await deleteMedia(p.id, photo.id)).toEqual({ ok: true });
      expect(destroyAsset.mock.calls).toEqual([[photo.publicId, "IMAGE"]]);
      expect(await tx.pendingDeletion.count({ where: { publicId: photo.publicId } })).toBe(0);
      expect(updateTag).toHaveBeenCalledWith("products");
      expect((await listMedia(tx, p.id)).map((m) => [m.id, m.isMain])).toEqual([
        [main.id, true],
        [video.id, false],
      ]);
      expect(requireAdmin).toHaveBeenCalled();
    });
  });

  it("deleteMedia: a failed destroy keeps the queue row with attempts 1 and logs one line; the medium is gone", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await rolledBack(async (tx) => {
        resetMocks();
        destroyAsset.mockRejectedValue(new Error("Cloudinary destroy: network error"));
        const p = await product(tx);
        const video = await media(tx, p.id, "VIDEO");
        expect(await deleteMedia(p.id, video.id)).toEqual({ ok: true });
        expect(await tx.pendingDeletion.findUnique({ where: { publicId: video.publicId } })).toMatchObject({ kind: "VIDEO", attempts: 1, lastError: "Cloudinary destroy: network error" });
        expect(await tx.productMedia.count({ where: { id: video.id } })).toBe(0);
        expect(log.mock.calls).toEqual([["[deleteMedia] destroy failed, left in pending_deletions:", 1]]);
      });
    } finally {
      log.mockRestore();
    }
  });
});

describe("committed fixture: the product lock under concurrent uploads (M3.4 K4, R8)", { timeout: 120_000 }, () => {
  const committed: string[] = [];
  const TX = { maxWait: 10_000, timeout: 60_000 };
  afterAll(async () => {
    // Its media rows cascade; they were never uploaded, so there is nothing to destroy.
    await db.product.deleteMany({ where: { id: { in: committed } } });
    expect(await db.product.count({ where: { id: { in: committed } } })).toBe(0);
  });

  it("barrier: B waits for A's product lock, so the product ends with one main image and distinct sortOrders", async () => {
    const p = await db.product.create({ data: { name: `Test M3 ${randomBytes(4).toString("hex")}`, category: "Test", type: "READY_STOCK", isActive: false } });
    committed.push(p.id);
    const image = (): NewMedia => ({
      publicId: `kagumi/dev/products/test-${randomUUID()}`,
      kind: "IMAGE",
      version: 1,
      format: "jpg",
      width: 10,
      height: 10,
      bytes: 1,
      durationSec: null,
    });
    const signal = () => {
      let open!: () => void;
      const opened = new Promise<void>((resolve) => (open = resolve));
      return { open, opened };
    };
    const aAdded = signal();
    const release = signal();
    let aPid = 0;
    let bSettled = false;

    const a = db.$transaction(async (tx) => {
      aPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
      const row = await addMediaRow(tx, p.id, image());
      aAdded.open();
      await release.opened;
      return row;
    }, TX);
    await aAdded.opened;
    const b = db.$transaction((tx) => addMediaRow(tx, p.id, image()), TX);
    b.finally(() => (bSettled = true)).catch(() => {});

    // The barrier: wait until Postgres reports a backend blocked by A (B, on the product row). No sleep.
    await expect
      .poll(
        async () =>
          Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE ${aPid}::int = ANY(pg_blocking_pids(pid))`)[0].n),
        { timeout: 30_000 },
      )
      .toBe(1);
    expect(bSettled).toBe(false);
    release.open();
    await expect(a).resolves.toMatchObject({ isMain: true, sortOrder: 0 });
    await expect(b).resolves.toMatchObject({ isMain: false, sortOrder: 1 });
    const rows = await db.productMedia.findMany({ where: { productId: p.id }, select: { isMain: true, sortOrder: true } });
    expect(rows.filter((r) => r.isMain)).toHaveLength(1);
    expect(new Set(rows.map((r) => r.sortOrder)).size).toBe(2);
  });
});
