// The products list's two empty lines (TR-M3-09, M3 plan D14 "Empty"). The page is rendered with its database
// replaced: no network.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductsPage from "@/app/admin/(protected)/produk/page";

const { findMany, groupBy } = vi.hoisted(() => ({ findMany: vi.fn(), groupBy: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ adminId: "test", sessionId: "test" }) }));
vi.mock("@/lib/db", () => ({ db: { product: { findMany, groupBy } } }));

const render = async (filter?: string) =>
  renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve(filter ? { filter } : {}) } as PageProps<"/admin/produk">));

describe("products list empty states (TR-M3-09)", () => {
  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([]);
    groupBy.mockReset();
  });

  it('says "Belum ada produk." when there is no product at all', async () => {
    groupBy.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("Belum ada produk.");
    expect(html).not.toContain("Tidak ada produk di filter ini.");
  });

  it('says "Tidak ada produk di filter ini." when products exist but the filter matches none', async () => {
    groupBy.mockResolvedValue([{ type: "PRE_ORDER", isActive: true, _count: { _all: 3 } }]);
    const html = await render("HIDDEN");
    expect(findMany.mock.calls[0][0].where).toEqual({ isActive: false });
    expect(html).toContain("Tidak ada produk di filter ini.");
    expect(html).not.toContain("Belum ada produk.");
    expect(html).not.toContain("<table");
  });
});
