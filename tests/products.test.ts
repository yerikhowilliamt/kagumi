import { describe, expect, it } from "vitest";
import { parseProductFilter } from "@/lib/products";

// M3 plan D14: `?filter=READY_STOCK`, `PRE_ORDER` or `HIDDEN`; anything else means all.
describe("parseProductFilter (D14)", () => {
  it.each(["READY_STOCK", "PRE_ORDER", "HIDDEN"])("accepts %s", (filter) => {
    expect(parseProductFilter({ filter })).toBe(filter);
  });

  it.each([[{}], [{ filter: "" }], [{ filter: "hidden" }], [{ filter: "ALL" }], [{ filter: "PRE_ORDER " }], [{ filter: "toString" }], [{ status: "HIDDEN" }]])(
    "means all for %j",
    (params) => {
      expect(parseProductFilter(params)).toBeNull();
    },
  );

  it("reads the first of repeated values", () => {
    expect(parseProductFilter({ filter: ["HIDDEN", "PRE_ORDER"] })).toBe("HIDDEN");
    expect(parseProductFilter({ filter: ["nope", "HIDDEN"] })).toBeNull();
  });
});
