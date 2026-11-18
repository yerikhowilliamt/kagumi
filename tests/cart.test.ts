import { describe, expect, it } from "vitest";
import { addLine, addOutcome, parseCart, removeLine, serializeCart, setQty, type CartLine } from "@/lib/cart";

// D21 load rules and FR8–FR9 (task file § M1.5, K8).
const ids = Array.from({ length: 25 }, (_, i) => `p${i}`);
const known = new Set(ids);
const raw = (v: unknown) => JSON.stringify(v);

describe("parseCart", () => {
  it("gives [] for missing, invalid JSON and non-arrays", () => {
    expect(parseCart(null, known)).toEqual([]);
    expect(parseCart("{not json", known)).toEqual([]);
    expect(parseCart(raw({ id: "p1", qty: 1 }), known)).toEqual([]);
    expect(parseCart(raw("p1"), known)).toEqual([]);
    expect(parseCart("null", known)).toEqual([]);
  });

  it("drops unknown ids and malformed entries", () => {
    const lines = parseCart(raw([{ id: "x", qty: 1 }, null, "p1", { qty: 2 }, { id: 3, qty: 1 }, { id: "p2", qty: 2 }]), known);
    expect(lines).toEqual([{ id: "p2", qty: 2 }]);
  });

  it("drops a non-numeric quantity", () => {
    expect(parseCart(raw([{ id: "p1", qty: "2" }, { id: "p2", qty: null }, { id: "p3" }]), known)).toEqual([]);
  });

  it("clamps quantities to 1–50", () => {
    const lines = parseCart(
      raw([
        { id: "p1", qty: 0 },
        { id: "p2", qty: -3 },
        { id: "p3", qty: 51 },
        { id: "p4", qty: 999 },
        { id: "p5", qty: 2.7 },
      ]),
      known,
    );
    expect(lines).toEqual([
      { id: "p1", qty: 1 },
      { id: "p2", qty: 1 },
      { id: "p3", qty: 50 },
      { id: "p4", qty: 50 },
      { id: "p5", qty: 2 },
    ]);
  });

  it("merges duplicates by adding quantities, capped at 50", () => {
    expect(parseCart(raw([{ id: "p1", qty: 2 }, { id: "p2", qty: 1 }, { id: "p1", qty: 3 }]), known)).toEqual([
      { id: "p1", qty: 5 },
      { id: "p2", qty: 1 },
    ]);
    expect(parseCart(raw([{ id: "p1", qty: 40 }, { id: "p1", qty: 40 }]), known)).toEqual([{ id: "p1", qty: 50 }]);
  });

  it("sums duplicates before truncating and clamping (approved #1, BSA-M1.5-02)", () => {
    expect(parseCart(raw([{ id: "p1", qty: 2.5 }, { id: "p1", qty: 2.5 }]), known)).toEqual([{ id: "p1", qty: 5 }]);
    expect(parseCart(raw([{ id: "p1", qty: -10 }, { id: "p1", qty: 5 }]), known)).toEqual([{ id: "p1", qty: 1 }]);
  });

  it("cuts more than 20 lines to the first 20 known ones", () => {
    const lines = parseCart(raw([{ id: "gone", qty: 1 }, ...ids.map((id) => ({ id, qty: 1 }))]), known);
    expect(lines).toHaveLength(20);
    expect(lines[0].id).toBe("p0");
    expect(lines[19].id).toBe("p19");
  });

  it("round-trips through serializeCart with only id and qty", () => {
    const lines: CartLine[] = [{ id: "p1", qty: 3 }];
    expect(serializeCart(lines)).toBe('[{"id":"p1","qty":3}]');
    expect(parseCart(serializeCart(lines), known)).toEqual(lines);
  });
});

describe("addLine", () => {
  it("appends a new product and adds to an existing one", () => {
    const one = addLine([], "p1", 1);
    expect(one).toEqual([{ id: "p1", qty: 1 }]);
    expect(addLine(one as CartLine[], "p1", 3)).toEqual([{ id: "p1", qty: 4 }]);
  });

  it("caps the quantity at 50", () => {
    expect(addLine([{ id: "p1", qty: 48 }], "p1", 5)).toEqual([{ id: "p1", qty: 50 }]);
  });

  it('returns "full" for a 21st product, but still adds to one of the 20', () => {
    const twenty = ids.slice(0, 20).map((id) => ({ id, qty: 1 }));
    expect(addLine(twenty, "p20", 1)).toBe("full");
    const more = addLine(twenty, "p5", 1);
    expect(more).not.toBe("full");
    expect((more as CartLine[]).find((l) => l.id === "p5")?.qty).toBe(2);
  });

  it("does not mutate its input", () => {
    const lines = [{ id: "p1", qty: 1 }];
    addLine(lines, "p1", 1);
    expect(lines).toEqual([{ id: "p1", qty: 1 }]);
  });
});

// BSA-M1.5-04, -05: the provider's add, as a pure function (a 21st product can't be reached with the 7 seed products in e2e).
describe("addOutcome", () => {
  it('saves the new lines and toasts "{name} ditambahkan"', () => {
    expect(addOutcome([{ id: "p1", qty: 45 }], "p1", 10, "Bolu")).toEqual({
      lines: [{ id: "p1", qty: 50 }],
      toast: "Bolu ditambahkan",
    });
  });

  it("changes nothing and shows no toast for a line already at 50 (approved #2)", () => {
    expect(addOutcome([{ id: "p1", qty: 50 }], "p1", 1, "Bolu")).toEqual({});
  });

  it("keeps the cart and shows the limit toast for a 21st product (D21, approved #3)", () => {
    const twenty = ids.slice(0, 20).map((id) => ({ id, qty: 1 }));
    expect(addOutcome(twenty, "p20", 1, "Bolu")).toEqual({ toast: "Keranjang maksimal 20 produk" });
  });
});

describe("setQty and removeLine", () => {
  const lines = [
    { id: "p1", qty: 2 },
    { id: "p2", qty: 1 },
  ];
  it("sets a quantity within 1–50", () => {
    expect(setQty(lines, "p1", 7)).toEqual([{ id: "p1", qty: 7 }, lines[1]]);
    expect(setQty(lines, "p1", 80)[0].qty).toBe(50);
  });
  it("removes the line at 0", () => {
    expect(setQty(lines, "p1", 0)).toEqual([lines[1]]);
  });
  it("removes a line", () => {
    expect(removeLine(lines, "p2")).toEqual([lines[0]]);
  });
});
