import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterMenu,
  hasOpenPreOrder,
  menuState,
  promoProduct,
  sortForMenu,
  toStoreProduct,
  type StoreProduct,
} from "@/lib/menu";

const media = (publicId: string, isMain: boolean, sortOrder: number) => ({
  publicId,
  kind: "IMAGE" as const,
  version: 1,
  format: "jpg",
  width: 800,
  height: 1000,
  durationSec: null,
  isMain,
  sortOrder,
});

const row = {
  id: "0193a1b2-0000-7000-8000-000000000001",
  name: "Hampers Natal",
  category: "Hampers",
  description: "Termasuk box.",
  price: 35000,
  type: "PRE_ORDER" as const,
  orderDeadline: new Date("2026-12-10"),
  media: [],
};

describe("toStoreProduct (D9)", () => {
  it("tone follows the menu position: butter, pink, sky, mint, then again", () => {
    expect([0, 1, 2, 3, 4, 5].map((index) => toStoreProduct(row, index).tone)).toEqual([
      "butter",
      "pink",
      "sky",
      "mint",
      "butter",
      "pink",
    ]);
  });

  it("the deadline is a YYYY-MM-DD string, or null", () => {
    expect(toStoreProduct(row, 0).orderDeadline).toBe("2026-12-10");
    expect(toStoreProduct({ ...row, orderDeadline: null }, 0).orderDeadline).toBeNull();
  });

  it("keeps the product fields and survives JSON (the page caches the result)", () => {
    const product = toStoreProduct({ ...row, price: null }, 0);
    expect(product).toEqual({
      id: row.id,
      name: "Hampers Natal",
      category: "Hampers",
      description: "Termasuk box.",
      price: null,
      type: "PRE_ORDER",
      orderDeadline: "2026-12-10",
      tone: "butter",
      media: [],
    });
    expect(JSON.parse(JSON.stringify(product))).toEqual(product);
  });

  it("media: the main one first, then by sortOrder", () => {
    const product = toStoreProduct({ ...row, media: [media("c", false, 2), media("a", false, 1), media("b", true, 3)] }, 0);
    expect(product.media.map((m) => m.publicId)).toEqual(["b", "a", "c"]);
    expect(product.media[0]).toEqual({
      publicId: "b",
      kind: "IMAGE",
      version: 1,
      format: "jpg",
      width: 800,
      height: 1000,
      durationSec: null,
      isMain: true,
    });
  });
});

// Products as the page holds them: already in sortOrder.
const product = (name: string, type: StoreProduct["type"], orderDeadline: string | null = null): StoreProduct => ({
  id: name,
  name,
  category: "",
  description: "",
  price: null,
  type,
  orderDeadline,
  tone: "butter",
  media: [],
});
const names = (list: StoreProduct[]) => list.map((p) => p.name);
const TODAY = "2026-12-11";

describe("sortForMenu (FR5)", () => {
  const list = [
    product("closed-1", "PRE_ORDER", "2026-12-10"),
    product("ready", "READY_STOCK"),
    product("last-day", "PRE_ORDER", TODAY),
    product("closed-2", "READY_STOCK", "2026-12-01"),
    product("no-deadline", "PRE_ORDER"),
  ];

  it("open products in their order, then closed ones in their order", () => {
    expect(names(sortForMenu(list, TODAY))).toEqual(["ready", "last-day", "no-deadline", "closed-1", "closed-2"]);
  });

  it("the deadline day itself is still open", () => {
    expect(names(sortForMenu(list, "2026-12-10"))).toEqual(["closed-1", "ready", "last-day", "no-deadline", "closed-2"]);
  });

  it("leaves its input alone", () => {
    const before = names(list);
    sortForMenu(list, TODAY);
    expect(names(list)).toEqual(before);
  });
});

describe("filterMenu (FR4)", () => {
  const list = [product("po", "PRE_ORDER"), product("ready", "READY_STOCK"), product("po-closed", "PRE_ORDER", "2026-01-01")];

  it("ALL keeps every product; a type keeps only that type, closed ones included", () => {
    expect(names(filterMenu(list, "ALL"))).toEqual(["po", "ready", "po-closed"]);
    expect(names(filterMenu(list, "READY_STOCK"))).toEqual(["ready"]);
    expect(names(filterMenu(list, "PRE_ORDER"))).toEqual(["po", "po-closed"]);
  });
});

describe("hasOpenPreOrder (System Design §4.2)", () => {
  it("false with no products, only ready stock, or only closed pre-orders", () => {
    expect(hasOpenPreOrder([], TODAY)).toBe(false);
    expect(hasOpenPreOrder([product("ready", "READY_STOCK"), product("ready-dated", "READY_STOCK", "2026-12-31")], TODAY)).toBe(false);
    expect(hasOpenPreOrder([product("closed", "PRE_ORDER", "2026-12-10")], TODAY)).toBe(false);
  });

  it("true with a pre-order on its deadline day or without a deadline", () => {
    expect(hasOpenPreOrder([product("last-day", "PRE_ORDER", TODAY)], TODAY)).toBe(true);
    expect(hasOpenPreOrder([product("closed", "PRE_ORDER", "2026-12-10"), product("open", "PRE_ORDER")], TODAY)).toBe(true);
  });
});

describe("promoProduct (System Design §4.2)", () => {
  it("the open pre-order with the nearest deadline", () => {
    const list = [product("none", "PRE_ORDER"), product("far", "PRE_ORDER", "2026-12-20"), product("near", "PRE_ORDER", "2026-12-15")];
    expect(promoProduct(list, TODAY)?.name).toBe("near");
  });

  it("a pre-order without a deadline comes after those with one", () => {
    expect(promoProduct([product("none", "PRE_ORDER"), product("far", "PRE_ORDER", "2026-12-20")], TODAY)?.name).toBe("far");
  });

  it("equal deadlines, and no deadlines at all: the first in sortOrder", () => {
    expect(promoProduct([product("a", "PRE_ORDER", "2026-12-20"), product("b", "PRE_ORDER", "2026-12-20")], TODAY)?.name).toBe("a");
    expect(promoProduct([product("a", "PRE_ORDER"), product("b", "PRE_ORDER")], TODAY)?.name).toBe("a");
  });

  it("skips closed pre-orders and every ready-stock product", () => {
    const list = [
      product("closed", "PRE_ORDER", "2026-12-10"),
      product("ready", "READY_STOCK", "2026-12-12"),
      product("open", "PRE_ORDER", "2026-12-20"),
    ];
    expect(promoProduct(list, TODAY)?.name).toBe("open");
    expect(promoProduct([product("last-day", "PRE_ORDER", TODAY)], TODAY)?.name).toBe("last-day");
  });

  it("null with no open pre-order", () => {
    expect(promoProduct([], TODAY)).toBeNull();
    expect(promoProduct([product("closed", "PRE_ORDER", "2026-12-10"), product("ready", "READY_STOCK")], TODAY)).toBeNull();
  });
});

describe("menuState (D8)", () => {
  const onlyPo = [product("po", "PRE_ORDER")];

  it("empty with no products, whatever the filter", () => {
    expect(menuState([], "ALL")).toBe("empty");
    expect(menuState([], "READY_STOCK")).toBe("empty");
  });

  it("no-match when the filter has no product", () => {
    expect(menuState(onlyPo, "READY_STOCK")).toBe("no-match");
    expect(menuState([product("ready", "READY_STOCK")], "PRE_ORDER")).toBe("no-match");
  });

  it("list otherwise, closed products included", () => {
    expect(menuState(onlyPo, "ALL")).toBe("list");
    expect(menuState(onlyPo, "PRE_ORDER")).toBe("list");
    expect(menuState([product("closed", "PRE_ORDER", "2026-01-01")], "PRE_ORDER")).toBe("list");
  });
});

describe("menu.ts is imported by client components (D17)", () => {
  it("imports only ./order, which itself imports nothing", () => {
    const code = readFileSync(join(import.meta.dirname, "../src/lib/menu.ts"), "utf8");
    const specifiers = [...code.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']/g)].map(
      (m) => m[1] ?? m[2] ?? m[3],
    );
    expect(specifiers).toEqual(["./order"]);
  });
});
