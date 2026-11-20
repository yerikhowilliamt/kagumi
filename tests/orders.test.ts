// The order list URL rules of task M2.4 (K2, K3, K4), written from the M2 plan D16 and System Design §4.9.
// No database: these are the pure parts of src/lib/orders.ts.
import { describe, expect, it } from "vitest";
import { orderIdFromSearch, orderListHref, parseOrderQuery } from "@/lib/orders";

describe("parseOrderQuery (D16 URL)", () => {
  it("reads status, q and page", () => {
    expect(parseOrderQuery({ status: "CONFIRMED", q: "rina", page: "2" })).toEqual({ status: "CONFIRMED", q: "rina", page: 2 });
  });

  it("an empty query lists everything from page 1", () => {
    expect(parseOrderQuery({})).toEqual({ status: null, q: "", page: 1 });
  });

  it.each(["new", "DONE", "", "NEW ", "all"])("an unknown status %j means all (K3)", (status) => {
    expect(parseOrderQuery({ status }).status).toBeNull();
  });

  it.each(["NEW", "CONFIRMED", "COMPLETED", "CANCELLED"])("knows %s", (status) => {
    expect(parseOrderQuery({ status }).status).toBe(status);
  });

  it.each(["0", "-1", "2abc", "1.5", "1e3", " 2", "", "abc"])("page %j is 1", (page) => {
    expect(parseOrderQuery({ page }).page).toBe(1);
  });

  it("drops U+0000 from q, so a NUL ends in a normal search (BSA-M2.4-02)", () => {
    expect(parseOrderQuery({ q: "a\u0000b" }).q).toBe("ab");
    expect(parseOrderQuery({ q: "\u0000" }).q).toBe("");
    expect(parseOrderQuery({ q: " \u0000 rina \u0000" }).q).toBe("rina");
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseOrderQuery({ status: ["NEW", "CANCELLED"], q: ["a", "b"], page: ["3", "4"] })).toEqual({
      status: "NEW",
      q: "a",
      page: 3,
    });
  });

  it("trims q and cuts it to 80 characters (K4)", () => {
    expect(parseOrderQuery({ q: "  rina  " }).q).toBe("rina");
    expect(parseOrderQuery({ q: "x".repeat(81) }).q).toBe("x".repeat(80));
    expect(parseOrderQuery({ q: `  ${"y".repeat(100)}` }).q).toBe("y".repeat(80));
    expect(parseOrderQuery({ q: "   " }).q).toBe("");
  });
});

describe("orderIdFromSearch (D16, K4)", () => {
  it.each(["KD-0123", "kd-123", "#KD-0123", "0123", "123", "KD0123", "#123", "Kd-00123"])("%s → 123", (q) => {
    expect(orderIdFromSearch(q)).toBe(123);
  });

  it.each(["KD-", "kd", "#", "rina", "KD-12a", "12 3", "1234567890", "KD--1", "-123", "# 123", ""])("%j is not a number", (q) => {
    expect(orderIdFromSearch(q)).toBeNull();
  });

  it("accepts up to nine digits after the leading zeros", () => {
    expect(orderIdFromSearch("999999999")).toBe(999_999_999);
    expect(orderIdFromSearch("000999999999")).toBe(999_999_999);
  });
});

describe("orderListHref (D5, D16: links keep status and q)", () => {
  it("keeps status and q on the next page", () => {
    const href = orderListHref({ status: "NEW", q: "rina w", page: 2 });
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/admin/pesanan");
    expect(url.searchParams.get("status")).toBe("NEW");
    expect(url.searchParams.get("q")).toBe("rina w");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("round-trips through parseOrderQuery, wildcards and # included", () => {
    const query = { status: "CANCELLED" as const, q: "50%_ #KD&x=1", page: 3 };
    const url = new URL(orderListHref(query), "http://x");
    expect(parseOrderQuery(Object.fromEntries(url.searchParams))).toEqual(query);
  });

  it("leaves out empty parts", () => {
    expect(orderListHref({ status: null, q: "", page: 1 })).toBe("/admin/pesanan");
    expect(orderListHref({ status: null, q: "", page: 2 })).toBe("/admin/pesanan?page=2");
  });
});
