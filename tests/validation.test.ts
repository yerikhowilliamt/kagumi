import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_LINES, MAX_QTY, checkoutSchema, normalizePhone } from "@/lib/validation";

const TODAY = "2026-11-17";
const id = (n: number) => `019a8f3e-7c2b-7abc-8def-${String(n).padStart(12, "0")}`; // UUID v7, as products.id

const MESSAGE = {
  nameRequired: "Nama wajib diisi.",
  nameMax: "Nama maksimal 80 karakter.",
  phone: "Isi nomor WhatsApp yang benar, contoh 0812-3456-7890.",
  fulfillment: "Pilih ambil sendiri atau diantar.",
  addressRequired: "Alamat wajib diisi untuk pengantaran.",
  addressMax: "Alamat maksimal 300 karakter.",
  dateRequired: "Pilih tanggal pesanan.",
  datePast: "Tanggal tidak boleh sebelum hari ini.",
  noteMax: "Catatan maksimal 500 karakter.",
  items: "Keranjang tidak valid. Muat ulang halaman lalu coba lagi.",
};

const DELIVERY = {
  customerName: "Rina",
  customerPhone: "0812-3456-7890",
  fulfillment: "DELIVERY",
  address: "Jl. Slamet Riyadi No. 1, Laweyan",
  requestedDate: "2026-12-20",
  note: "Tanpa kacang",
  items: [
    { productId: id(1), quantity: 2 },
    { productId: id(2), quantity: 1 },
  ],
};

function accepted(input: unknown, today = TODAY) {
  const result = checkoutSchema(today).safeParse(input);
  if (!result.success) throw new Error(`expected success: ${JSON.stringify(result.error.issues)}`);
  return result.data;
}

// The first message of each top-level field, the form D2 reports (`fields`).
function errors(input: unknown, today = TODAY) {
  const result = checkoutSchema(today).safeParse(input);
  const fields: Record<string, string> = {};
  if (!result.success) for (const issue of result.error.issues) fields[String(issue.path[0] ?? "")] ??= issue.message;
  return fields;
}

const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ productId: id(i + 1), quantity: 1 }));

describe("normalizePhone (System Design §9)", () => {
  it("normalizes the accepted forms to 628…", () => {
    for (const raw of ["0812-3456-7890", "+62 812 3456 7890", "6281234567890", "(0812) 3456.7890", " 0812 3456\t7890 "]) {
      expect(normalizePhone(raw)).toBe("6281234567890");
    }
  });

  it("accepts 10 to 15 normalized digits", () => {
    expect(normalizePhone("6281234567")).toBe("6281234567"); // 10
    expect(normalizePhone("081234567")).toBe("6281234567"); // 10 after normalizing
    expect(normalizePhone("628123456789012")).toBe("628123456789012"); // 15
    expect(normalizePhone("628123456")).toBeNull(); // 9
    expect(normalizePhone("08123456")).toBeNull(); // 9 after normalizing
    expect(normalizePhone("6281234567890123")).toBeNull(); // 16
  });

  it("rejects other prefixes, letters and an empty string", () => {
    for (const raw of [
      "",
      "   ",
      "0712345678901",
      "6221123456789",
      "81234567890",
      "+6221123456789",
      "+081234567890",
      "08abc4567890",
      "0812+34567890",
      "++6281234567890",
      "62 0812 3456 7890",
    ]) {
      expect(normalizePhone(raw), raw).toBeNull();
    }
  });
});

describe("checkoutSchema(today) (D2 input, D10 messages)", () => {
  it("accepts a delivery order and returns the stored form", () => {
    expect(accepted(DELIVERY)).toEqual({ ...DELIVERY, customerPhone: "6281234567890" });
  });

  it("limits match System Design §9", () => {
    expect(MAX_LINES).toBe(20);
    expect(MAX_QTY).toBe(50);
  });

  describe("customerName", () => {
    it("is trimmed and holds 1 to 80 characters", () => {
      expect(accepted({ ...DELIVERY, customerName: "  Rina  " }).customerName).toBe("Rina");
      expect(accepted({ ...DELIVERY, customerName: "a".repeat(80) }).customerName).toHaveLength(80);
      expect(accepted({ ...DELIVERY, customerName: ` ${"a".repeat(80)} ` }).customerName).toHaveLength(80);
    });

    it("is required", () => {
      const { customerName, ...missing } = DELIVERY;
      expect(customerName).toBeTruthy();
      for (const input of [missing, { ...DELIVERY, customerName: "" }, { ...DELIVERY, customerName: "   " }, { ...DELIVERY, customerName: 5 }]) {
        expect(errors(input)).toEqual({ customerName: MESSAGE.nameRequired });
      }
    });

    it("rejects 81 characters", () => {
      expect(errors({ ...DELIVERY, customerName: "a".repeat(81) })).toEqual({ customerName: MESSAGE.nameMax });
    });
  });

  describe("customerPhone", () => {
    it("is stored as 628…", () => {
      for (const customerPhone of ["0812-3456-7890", "+62 812 3456 7890", "6281234567890", "(0812) 3456.7890"]) {
        expect(accepted({ ...DELIVERY, customerPhone }).customerPhone).toBe("6281234567890");
      }
    });

    it("rejects a number that does not normalize", () => {
      const { customerPhone, ...missing } = DELIVERY;
      expect(customerPhone).toBeTruthy();
      for (const input of [
        missing,
        { ...DELIVERY, customerPhone: "" },
        { ...DELIVERY, customerPhone: "08123456" },
        { ...DELIVERY, customerPhone: "6281234567890123" },
        { ...DELIVERY, customerPhone: "0712345678901" },
        { ...DELIVERY, customerPhone: "08abc4567890" },
        { ...DELIVERY, customerPhone: 81234567890 },
      ]) {
        expect(errors(input)).toEqual({ customerPhone: MESSAGE.phone });
      }
    });
  });

  describe("fulfillment", () => {
    it("is PICKUP or DELIVERY", () => {
      expect(accepted({ ...DELIVERY, fulfillment: "PICKUP" }).fulfillment).toBe("PICKUP");
      expect(accepted(DELIVERY).fulfillment).toBe("DELIVERY");
    });

    it("rejects anything else", () => {
      const { fulfillment, ...missing } = DELIVERY;
      expect(fulfillment).toBeTruthy();
      for (const input of [missing, { ...DELIVERY, fulfillment: "SHIP" }, { ...DELIVERY, fulfillment: "pickup" }]) {
        expect(errors(input)).toEqual({ fulfillment: MESSAGE.fulfillment });
      }
    });
  });

  describe("address", () => {
    const { address, ...withoutAddress } = DELIVERY;

    it("delivery: trimmed, up to 300 characters", () => {
      expect(accepted({ ...DELIVERY, address: `  ${address}\n` }).address).toBe(address);
      expect(accepted({ ...DELIVERY, address: "a".repeat(300) }).address).toHaveLength(300);
    });

    it("delivery: required and not blank", () => {
      for (const input of [withoutAddress, { ...DELIVERY, address: "" }, { ...DELIVERY, address: "   " }, { ...DELIVERY, address: null }]) {
        expect(errors(input)).toEqual({ address: MESSAGE.addressRequired });
      }
    });

    it("delivery: rejects 301 characters", () => {
      expect(errors({ ...DELIVERY, address: "a".repeat(301) })).toEqual({ address: MESSAGE.addressMax });
    });

    it("pickup: stored as null, whatever was sent", () => {
      for (const input of [
        { ...withoutAddress, fulfillment: "PICKUP" },
        { ...DELIVERY, fulfillment: "PICKUP" },
        { ...DELIVERY, fulfillment: "PICKUP", address: "a".repeat(400) },
      ]) {
        const data = accepted(input);
        expect(data).toHaveProperty("address", null);
        expect(data.fulfillment).toBe("PICKUP");
      }
    });
  });

  describe("requestedDate", () => {
    it("accepts today and later days", () => {
      for (const requestedDate of ["2026-11-17", "2026-11-18", "2027-01-01", "2028-02-29"]) {
        expect(accepted({ ...DELIVERY, requestedDate }).requestedDate).toBe(requestedDate);
      }
    });

    it("rejects the day before today", () => {
      for (const requestedDate of ["2026-11-16", "2025-12-31"]) {
        expect(errors({ ...DELIVERY, requestedDate })).toEqual({ requestedDate: MESSAGE.datePast });
      }
    });

    it("compares with the `today` it was given, not with the clock", () => {
      expect(accepted({ ...DELIVERY, requestedDate: "2026-11-17" }, "2026-11-17").requestedDate).toBe("2026-11-17");
      expect(errors({ ...DELIVERY, requestedDate: "2026-11-17" }, "2026-11-18")).toEqual({ requestedDate: MESSAGE.datePast });
      expect(accepted({ ...DELIVERY, requestedDate: "2020-01-01" }, "2020-01-01").requestedDate).toBe("2020-01-01");
    });

    it("rejects a missing date and a date that is not a real day", () => {
      const { requestedDate, ...missing } = DELIVERY;
      expect(requestedDate).toBeTruthy();
      for (const input of [
        missing,
        { ...DELIVERY, requestedDate: "" },
        { ...DELIVERY, requestedDate: "2026-02-30" },
        { ...DELIVERY, requestedDate: "2027-02-29" },
        { ...DELIVERY, requestedDate: "2026-13-01" },
        { ...DELIVERY, requestedDate: "20/12/2026" },
        { ...DELIVERY, requestedDate: "2026-12-20T00:00:00Z" },
        { ...DELIVERY, requestedDate: "2026-1-5" },
      ]) {
        expect(errors(input)).toEqual({ requestedDate: MESSAGE.dateRequired });
      }
    });

    it("gives a value that is not a date one message, not also the before-today one", () => {
      const result = checkoutSchema(TODAY).safeParse({ ...DELIVERY, requestedDate: "20/12/2026" });
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([MESSAGE.dateRequired]);
    });
  });

  describe("note", () => {
    it("is trimmed and holds up to 500 characters", () => {
      expect(accepted({ ...DELIVERY, note: "  Tanpa kacang \n" }).note).toBe("Tanpa kacang");
      expect(accepted({ ...DELIVERY, note: "a".repeat(500) }).note).toHaveLength(500);
    });

    it("blank or missing becomes null", () => {
      const { note, ...missing } = DELIVERY;
      expect(note).toBeTruthy();
      for (const input of [missing, { ...DELIVERY, note: "" }, { ...DELIVERY, note: "  \n " }]) {
        expect(accepted(input).note).toBeNull();
      }
    });

    it("rejects 501 characters", () => {
      expect(errors({ ...DELIVERY, note: "a".repeat(501) })).toEqual({ note: MESSAGE.noteMax });
    });
  });

  describe("items", () => {
    it("accepts 1 to 20 lines", () => {
      expect(accepted({ ...DELIVERY, items: lines(1) }).items).toHaveLength(1);
      expect(accepted({ ...DELIVERY, items: lines(20) }).items).toHaveLength(20);
    });

    it("accepts quantities 1 and 50", () => {
      const items = [
        { productId: id(1), quantity: 1 },
        { productId: id(2), quantity: 50 },
      ];
      expect(accepted({ ...DELIVERY, items }).items).toEqual(items);
    });

    it.each([
      ["no items key", undefined],
      ["not an array", "x"],
      ["0 lines", []],
      ["21 lines", lines(21)],
      ["quantity 0", [{ productId: id(1), quantity: 0 }]],
      ["quantity 51", [{ productId: id(1), quantity: 51 }]],
      ["quantity 1.5", [{ productId: id(1), quantity: 1.5 }]],
      ["quantity as a string", [{ productId: id(1), quantity: "2" }]],
      ["quantity missing", [{ productId: id(1) }]],
      ["id not a uuid", [{ productId: "abc", quantity: 1 }]],
      ["id missing", [{ quantity: 1 }]],
      ["line not an object", ["x"]],
      ["a repeated id", [{ productId: id(1), quantity: 1 }, { productId: id(2), quantity: 1 }, { productId: id(1), quantity: 2 }]],
    ])("rejects %s", (_, items) => {
      expect(errors({ ...DELIVERY, items })).toEqual({ items: MESSAGE.items });
    });
  });

  it("drops unknown keys, so client-sent names and prices are never read", () => {
    const data = accepted({
      ...DELIVERY,
      total: 1,
      status: "COMPLETED",
      items: [{ productId: id(1), quantity: 2, name: "Gratis", unitPrice: 1, price: 1 }],
    });
    expect(data).toEqual({ ...DELIVERY, customerPhone: "6281234567890", items: [{ productId: id(1), quantity: 2 }] });
  });

  it("rejects input that is not an object", () => {
    for (const input of [null, undefined, "x", 5, [DELIVERY]]) {
      expect(checkoutSchema(TODAY).safeParse(input).success).toBe(false);
    }
  });

  it("reports every invalid field in one parse", () => {
    expect(
      errors({ customerName: " ", customerPhone: "123", fulfillment: "DELIVERY", note: "a".repeat(501), items: [] }),
    ).toEqual({
      customerName: MESSAGE.nameRequired,
      customerPhone: MESSAGE.phone,
      address: MESSAGE.addressRequired,
      requestedDate: MESSAGE.dateRequired,
      note: MESSAGE.noteMax,
      items: MESSAGE.items,
    });
  });
});

describe("modules imported by client components (D17, D23)", () => {
  const source = (file: string) => readFileSync(join(import.meta.dirname, "../src/lib", file), "utf8");
  // Every module specifier: `from "x"`, `import "x"`, `import("x")`, `require("x")`.
  const specifiers = (code: string) =>
    [...code.matchAll(/(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);

  it("the specifier scan sees every import form", () => {
    expect(
      specifiers(`
        import { readFileSync } from "node:fs";
        import type { Db } from '@/lib/db';
        import "next/headers";
        export { Prisma } from "@prisma/client";
        const a = await import("node:crypto");
        const b = require("next/cache");
      `),
    ).toEqual(["node:fs", "@/lib/db", "next/headers", "@prisma/client", "node:crypto", "next/cache"]);
  });

  it("order.ts imports nothing", () => {
    expect(specifiers(source("order.ts"))).toEqual([]);
  });

  it("validation.ts imports only zod and ./order", () => {
    const found = specifiers(source("validation.ts"));
    expect(found).toContain("zod");
    expect(found.filter((name) => name !== "zod" && name !== "./order")).toEqual([]);
  });

  it("neither uses Intl or locale formatting", () => {
    for (const file of ["order.ts", "validation.ts"]) {
      expect(source(file)).not.toMatch(/\bIntl\b|toLocale/);
    }
  });
});
