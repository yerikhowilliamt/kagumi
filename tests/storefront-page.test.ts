// The storefront page rendered with its database and data cache replaced: no network (BSA-M1.2-01, -02).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/(store)/page";
import { toStoreProduct } from "@/lib/menu";

const { findMany, cached } = vi.hoisted(() => ({
  findMany: vi.fn(),
  cached: [] as { fn: () => Promise<unknown>; keys: string[]; options: unknown }[],
}));

vi.mock("@/lib/db", () => ({ db: { product: { findMany } } }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, keys: string[], options: unknown) => {
    cached.push({ fn, keys, options });
    return fn;
  },
}));

// Rows as Prisma returns them: a `date` column is a Date at UTC midnight.
const ROWS = [
  { name: "Bolu Gulung", orderDeadline: null },
  { name: "Hampers Natal", orderDeadline: new Date("2026-12-10T00:00:00.000Z") },
].map((row, i) => ({ id: `p${i}`, category: "Kue", description: "", price: 10000, type: "PRE_ORDER", media: [], ...row }));

const render = async () => renderToStaticMarkup(await Home());

describe("storefront page", () => {
  beforeEach(() => findMany.mockReset().mockResolvedValue(ROWS));

  it("reads only active products, in sortOrder, through the cache tagged products", async () => {
    await render();
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ isActive: true });
    expect(args.orderBy[0]).toEqual({ sortOrder: "asc" });
    expect(cached).toHaveLength(1);
    expect(cached[0].options).toEqual({ tags: ["products"], revalidate: 3600 });
  });

  it("maps rows inside the cached function, so the cached value survives JSON", async () => {
    const products = (await cached[0].fn()) as { orderDeadline: unknown }[];
    expect(products.map((p) => p.orderDeadline)).toEqual([null, "2026-12-10"]);
    expect(JSON.parse(JSON.stringify(products))).toEqual(products);
  });

  it("keys the cache on the mapper's text, so a new mapped shape never reads an old entry (TR-M1.2-03)", () => {
    expect(cached[0].keys).toContain(toStoreProduct.toString());
  });

  it("renders the marquee with each product name twice", async () => {
    const html = await render();
    expect(html).toContain('data-testid="marquee"');
    expect(html.match(/Hampers Natal/g)).toHaveLength(2);
  });

  it("hides the marquee with no active products and still renders the page", async () => {
    findMany.mockResolvedValue([]);
    const html = await render();
    expect(html).not.toContain('data-testid="marquee"');
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('id="menu"');
  });
});
