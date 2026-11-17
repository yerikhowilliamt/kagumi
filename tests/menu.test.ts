import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toStoreProduct } from "@/lib/menu";

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

describe("menu.ts is imported by client components (D17)", () => {
  it("imports nothing", () => {
    const code = readFileSync(join(import.meta.dirname, "../src/lib/menu.ts"), "utf8");
    expect(code).not.toMatch(/\bfrom\s*["']|\bimport\s*\(?\s*["']|\brequire\s*\(/);
  });
});
