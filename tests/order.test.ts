import { describe, expect, it } from "vitest";
import {
  SHOP_WHATSAPP,
  buildOrderMessage,
  chatGreeting,
  chatUrl,
  formatDateLong,
  formatDateMedium,
  formatDateShort,
  formatJakartaTime,
  formatOrderNumber,
  formatPhone,
  formatRupiah,
  formatSubtotal,
  formatWhen,
  isClosed,
  itemTotals,
  jakartaToday,
  summarize,
  whatsappUrl,
  type OrderCustomer,
  type OrderLine,
} from "@/lib/order";
import { checkoutSchema } from "@/lib/validation";

// The two examples of the WhatsApp message contract (D1, System Design §4.3), byte for byte.
const SUCCESS = `Halo Kagumi Dough! Aku mau pesan (dari website)

No. pesanan: KD-0065
• 2× Hampers Natal — Rp70.000
• 1× Bolu Gulung — harga via WA

Subtotal: Rp70.000 (+ 1 produk harga via WA)
Nama: Rina
Pengambilan: Diantar
Alamat: Jl. Slamet Riyadi No. 1, Laweyan
Tanggal: Minggu, 20 Desember 2026
Catatan: Kartu ucapan "Selamat Natal"`;

const FALLBACK = `Halo Kagumi Dough! Aku mau pesan (dari website)

• 2× Hampers Natal — Rp70.000
• 1× Bolu Gulung — harga via WA

Subtotal: Rp70.000 (+ 1 produk harga via WA)
Nama: Rina
Pengambilan: Diantar
Alamat: Jl. Slamet Riyadi No. 1, Laweyan
Tanggal: Minggu, 20 Desember 2026
Catatan: Kartu ucapan "Selamat Natal"`;

const HAMPERS: OrderLine = { name: "Hampers Natal", unitPrice: 35000, quantity: 2 };
const BOLU: OrderLine = { name: "Bolu Gulung", unitPrice: null, quantity: 1 };
const LINES = [HAMPERS, BOLU];
const CUSTOMER: OrderCustomer = {
  customerName: "Rina",
  fulfillment: "DELIVERY",
  address: "Jl. Slamet Riyadi No. 1, Laweyan",
  requestedDate: "2026-12-20",
  note: 'Kartu ucapan "Selamat Natal"',
};

describe("formatOrderNumber (System Design §9)", () => {
  it("pads to four digits and keeps longer numbers whole", () => {
    expect(formatOrderNumber(1)).toBe("KD-0001");
    expect(formatOrderNumber(65)).toBe("KD-0065");
    expect(formatOrderNumber(9999)).toBe("KD-9999");
    expect(formatOrderNumber(10000)).toBe("KD-10000");
  });
});

describe("formatRupiah (D23)", () => {
  it('writes "Rp" and groups thousands with "."', () => {
    expect(formatRupiah(999)).toBe("Rp999");
    expect(formatRupiah(1000)).toBe("Rp1.000");
    expect(formatRupiah(35000)).toBe("Rp35.000");
    expect(formatRupiah(100000)).toBe("Rp100.000");
    expect(formatRupiah(1250000)).toBe("Rp1.250.000");
  });
});

describe("jakartaToday (D23: WIB = UTC + 7 h)", () => {
  it("changes the date at 17:00 UTC", () => {
    expect(jakartaToday(new Date("2026-11-17T16:59:59Z"))).toBe("2026-11-17");
    expect(jakartaToday(new Date("2026-11-17T17:00:00Z"))).toBe("2026-11-18");
    expect(jakartaToday(new Date("2026-12-31T17:00:00Z"))).toBe("2027-01-01");
  });

  it("does not depend on the machine's time zone", () => {
    const saved = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Honolulu";
      // Proves the override is in effect, so the lines below are not vacuous.
      expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(600);
      expect(jakartaToday(new Date("2026-11-17T17:00:00Z"))).toBe("2026-11-18");
      expect(formatDateLong("2026-12-20")).toBe("Minggu, 20 Desember 2026");
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});

describe("formatJakartaTime (M2.3 K4, D17: WIB = UTC + 7 h)", () => {
  it.each([
    ["2026-11-19T07:32:00Z", "14.32"],
    ["2026-11-19T16:59:00Z", "23.59"],
    ["2026-11-19T17:00:00Z", "00.00"],
  ])("%s → %s", (instant, expected) => {
    expect(formatJakartaTime(new Date(instant))).toBe(expected);
  });
});

describe("isClosed (the deadline is the last open day, ERD products.orderDeadline)", () => {
  it("is open on the deadline and closed the day after", () => {
    expect(isClosed("2026-12-10", "2026-12-10")).toBe(false);
    expect(isClosed("2026-12-10", "2026-12-11")).toBe(true);
    expect(isClosed("2026-12-10", "2026-12-09")).toBe(false);
    expect(isClosed("2026-12-31", "2027-01-01")).toBe(true);
  });

  it("is open without a deadline", () => {
    expect(isClosed(null, "2026-12-10")).toBe(false);
  });
});

describe("formatDateLong (D23)", () => {
  it("names the day, the day of the month without a leading zero, the month and the year", () => {
    expect(formatDateLong("2026-12-20")).toBe("Minggu, 20 Desember 2026");
    expect(formatDateLong("2026-12-05")).toBe("Sabtu, 5 Desember 2026");
  });

  it("names the seven days", () => {
    expect(["16", "17", "18", "19", "20", "21", "22"].map((d) => formatDateLong(`2026-11-${d}`))).toEqual([
      "Senin, 16 November 2026",
      "Selasa, 17 November 2026",
      "Rabu, 18 November 2026",
      "Kamis, 19 November 2026",
      "Jumat, 20 November 2026",
      "Sabtu, 21 November 2026",
      "Minggu, 22 November 2026",
    ]);
  });

  it("names the twelve months", () => {
    const months = Array.from({ length: 12 }, (_, i) =>
      formatDateLong(`2026-${String(i + 1).padStart(2, "0")}-01`).split(", ")[1],
    );
    expect(months).toEqual([
      "1 Januari 2026",
      "1 Februari 2026",
      "1 Maret 2026",
      "1 April 2026",
      "1 Mei 2026",
      "1 Juni 2026",
      "1 Juli 2026",
      "1 Agustus 2026",
      "1 September 2026",
      "1 Oktober 2026",
      "1 November 2026",
      "1 Desember 2026",
    ]);
  });
});

describe("formatDateShort (D23)", () => {
  it("writes the day and the short month", () => {
    expect(formatDateShort("2026-12-10")).toBe("10 Des");
    expect(formatDateShort("2026-08-05")).toBe("5 Agu");
  });

  it("uses the twelve short months of D23", () => {
    const months = Array.from({ length: 12 }, (_, i) => formatDateShort(`2026-${String(i + 1).padStart(2, "0")}-10`));
    expect(months).toEqual(
      ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"].map((m) => `10 ${m}`),
    );
  });
});

describe("summarize (FR10)", () => {
  it("adds only priced lines and counts unpriced lines, not their quantity", () => {
    expect(summarize(LINES)).toEqual({ subtotal: 70000, unpriced: 1 });
    expect(
      summarize([HAMPERS, { name: "Bolu Gulung", unitPrice: null, quantity: 3 }, { name: "Donat", unitPrice: 10000, quantity: 1 }]),
    ).toEqual({ subtotal: 80000, unpriced: 1 });
    expect(summarize([BOLU, { name: "Brownies", unitPrice: null, quantity: 2 }])).toEqual({ subtotal: 0, unpriced: 2 });
    expect(summarize([])).toEqual({ subtotal: 0, unpriced: 0 });
  });
});

describe("buildOrderMessage (D1, FR13)", () => {
  const subtotalLine = (lines: OrderLine[]) =>
    buildOrderMessage({ lines, customer: CUSTOMER })
      .split("\n")
      .find((line) => line.startsWith("Subtotal:"));

  it("equals the success example byte for byte", () => {
    expect(buildOrderMessage({ orderNumber: "KD-0065", lines: LINES, customer: CUSTOMER })).toBe(SUCCESS);
  });

  it("equals the fallback example byte for byte: no order number line", () => {
    expect(buildOrderMessage({ lines: LINES, customer: CUSTOMER })).toBe(FALLBACK);
  });

  it("keeps the cart order", () => {
    const lines = buildOrderMessage({ lines: [BOLU, HAMPERS], customer: CUSTOMER }).split("\n");
    expect(lines.slice(2, 4)).toEqual(["• 1× Bolu Gulung — harga via WA", "• 2× Hampers Natal — Rp70.000"]);
  });

  it("writes the plain subtotal when every line has a price", () => {
    expect(subtotalLine([HAMPERS, { name: "Donat", unitPrice: 12500, quantity: 4 }])).toBe("Subtotal: Rp120.000");
  });

  it("counts unpriced lines, not their quantity", () => {
    expect(subtotalLine([HAMPERS, { name: "Bolu Gulung", unitPrice: null, quantity: 3 }])).toBe(
      "Subtotal: Rp70.000 (+ 1 produk harga via WA)",
    );
    expect(subtotalLine([HAMPERS, BOLU, { name: "Brownies", unitPrice: null, quantity: 2 }])).toBe(
      "Subtotal: Rp70.000 (+ 2 produk harga via WA)",
    );
  });

  it('writes "harga via WA" as the subtotal when no line has a price', () => {
    const message = buildOrderMessage({ lines: [BOLU, { name: "Brownies", unitPrice: null, quantity: 2 }], customer: CUSTOMER });
    expect(message.split("\n").slice(2, 6)).toEqual([
      "• 1× Bolu Gulung — harga via WA",
      "• 2× Brownies — harga via WA",
      "",
      "Subtotal: harga via WA",
    ]);
  });

  it("pickup: no address line, even when an address was typed", () => {
    const message = buildOrderMessage({ lines: LINES, customer: { ...CUSTOMER, fulfillment: "PICKUP" } });
    expect(message.split("\n").slice(6)).toEqual([
      "Nama: Rina",
      "Pengambilan: Ambil sendiri",
      "Tanggal: Minggu, 20 Desember 2026",
      'Catatan: Kartu ucapan "Selamat Natal"',
    ]);
    expect(buildOrderMessage({ lines: LINES, customer: { ...CUSTOMER, fulfillment: "PICKUP", address: null } })).toBe(message);
  });

  it("leaves the note line out when the note is blank, null or missing", () => {
    const { note, ...withoutNote } = CUSTOMER;
    expect(note).toBeTruthy();
    for (const customer of [{ ...CUSTOMER, note: "" }, { ...CUSTOMER, note: "  \n " }, { ...CUSTOMER, note: null }, withoutNote]) {
      const lines = buildOrderMessage({ lines: LINES, customer }).split("\n");
      expect(lines.at(-1)).toBe("Tanggal: Minggu, 20 Desember 2026");
      expect(lines.some((line) => line.startsWith("Catatan"))).toBe(false);
    }
  });

  it("trims the customer's values", () => {
    const customer = {
      ...CUSTOMER,
      customerName: "  Rina ",
      address: " Jl. Slamet Riyadi No. 1, Laweyan\n",
      note: '  Kartu ucapan "Selamat Natal"  ',
    };
    expect(buildOrderMessage({ orderNumber: "KD-0065", lines: LINES, customer })).toBe(SUCCESS);
  });

  it("keeps line breaks inside the address and the note", () => {
    const message = buildOrderMessage({ lines: LINES, customer: { ...CUSTOMER, address: "Jl. A\nRT 01", note: "a\nb" } });
    expect(message).toContain("\nAlamat: Jl. A\nRT 01\n");
    expect(message.endsWith("\nCatatan: a\nb")).toBe(true);
  });

  it("never contains the customer's phone (System Design §4.3 step 5)", () => {
    const customer = { ...CUSTOMER, customerPhone: "6281234567890" };
    const message = buildOrderMessage({ orderNumber: "KD-0065", lines: LINES, customer });
    expect(message).toBe(SUCCESS);
    expect(message).not.toContain("81234567890");
  });
});

describe("whatsappUrl (D1)", () => {
  const PREFIX = "https://wa.me/6285159545168?text=";

  it("targets the shop's number", () => {
    expect(SHOP_WHATSAPP).toBe("6285159545168");
  });

  it("is the prefix plus the URI-encoded message", () => {
    const url = whatsappUrl(SUCCESS);
    expect(url.startsWith(PREFIX)).toBe(true);
    expect(decodeURIComponent(url.slice(PREFIX.length))).toBe(SUCCESS);
  });

  it("encodes characters that would end or split the text parameter", () => {
    const message = buildOrderMessage({ lines: LINES, customer: { ...CUSTOMER, note: "a & b # c + d ? e = f" } });
    const text = whatsappUrl(message).slice(PREFIX.length);
    expect(text).not.toMatch(/[&#+?=\s]/);
    expect(decodeURIComponent(text)).toBe(message);
  });

  // Milestone plan §7: the longest link is recorded, not checked against a limit (none is documented).
  // The two numbers are the output of this code on 2026-11-17; a change of the message format moves them.
  it("records the length of the longest possible link", () => {
    const longest = (char: string, unitPrice: number) =>
      whatsappUrl(
        buildOrderMessage({
          orderNumber: "KD-999999",
          lines: Array.from({ length: 20 }, () => ({ name: char.repeat(80), unitPrice, quantity: 50 })),
          customer: {
            customerName: char.repeat(80),
            fulfillment: "DELIVERY",
            address: char.repeat(300),
            requestedDate: "2026-09-30",
            note: char.repeat(500),
          },
        }),
      ).length;
    expect({ ascii: longest("a", 100000), threeByteCharacters: longest("€", 2147483647) }).toEqual({ ascii: 3799, threeByteCharacters: 23765 });
  });

  // TR-M1.1-01 (option c, approved 2026-11-18): every text the checkout schema accepts can be put into the link.
  it("replaces a lone surrogate with U+FFFD and keeps surrogate pairs", () => {
    const text = (message: string) => decodeURIComponent(whatsappUrl(message).slice(PREFIX.length));
    expect(text("a\uD800b")).toBe("a\uFFFDb");
    expect(text("a\uDC00")).toBe("a\uFFFD");
    expect(text("\uDC00\uD800")).toBe("\uFFFD\uFFFD");
    expect(text("Kue 🎄 Natal")).toBe("Kue 🎄 Natal");
  });

  it("encodes every name, address and note the schema accepts, including a lone surrogate and U+0000", () => {
    for (const bad of ["\uD83D", "\uDE00x", "a\u0000b"]) {
      const parsed = checkoutSchema("2026-11-17").parse({
        customerName: `Rina ${bad}`,
        customerPhone: "081234567890",
        fulfillment: "DELIVERY",
        address: `Jl. ${bad}`,
        requestedDate: "2026-11-20",
        note: `Catatan ${bad}`,
        items: [{ productId: "019a8f3e-7c2b-7abc-8def-000000000001", quantity: 1 }],
      });
      expect(() => whatsappUrl(buildOrderMessage({ lines: LINES, customer: parsed }))).not.toThrow();
    }
  });
});

// M2.4 K5, K6 (M2 plan D16, X5): the order list formats, in WIB (M1-D23).
describe("formatWhen (M2.4 K6, D16)", () => {
  const now = new Date("2026-11-19T17:30:00Z"); // 00.30 WIB on 20 Nov 2026
  it.each([
    ["2026-11-19T17:00:00Z", "Hari ini, 00.00"], // WIB 20 Nov, though UTC is still 19 Nov
    ["2026-11-19T16:59:00Z", "Kemarin, 23.59"], // WIB 19 Nov, across 17:00 UTC
    ["2026-11-18T17:00:00Z", "Kemarin, 00.00"],
    ["2026-11-18T16:59:00Z", "18 Nov, 23.59"], // two WIB days back
    ["2026-11-12T09:10:00Z", "12 Nov, 16.10"],
    ["2026-01-01T00:00:00Z", "1 Jan, 07.00"],
    ["2025-11-12T09:10:00Z", "12 Nov 2025, 16.10"],
    ["2025-12-31T16:59:00Z", "31 Des 2025, 23.59"], // WIB 31 Dec 2025: another year
  ])("%s → %s", (instant, expected) => {
    expect(formatWhen(new Date(instant), now)).toBe(expected);
  });

  it("is 'Kemarin' across a year boundary", () => {
    expect(formatWhen(new Date("2026-12-31T10:00:00Z"), new Date("2027-01-01T03:00:00Z"))).toBe("Kemarin, 17.00");
  });
});

describe("formatDateMedium (M2.4 K6)", () => {
  it.each([
    ["2026-12-20", "20 Des 2026"],
    ["2027-01-05", "5 Jan 2027"],
  ])("%s → %s", (ymd, expected) => {
    expect(formatDateMedium(ymd)).toBe(expected);
  });
});

describe("itemTotals and formatSubtotal (M2.4 K5, X5)", () => {
  it("counts quantities, not lines, and sums only priced lines", () => {
    expect(
      itemTotals([
        { unitPrice: 85_000, quantity: 2 },
        { unitPrice: null, quantity: 1 },
      ]),
    ).toEqual({ quantity: 3, subtotal: 170_000, unpriced: 1 });
  });

  it("all priced → Rp…; some unpriced → Rp…+; none priced → —", () => {
    expect(formatSubtotal(itemTotals([{ unitPrice: 35_000, quantity: 2 }]))).toBe("Rp70.000");
    expect(
      formatSubtotal(
        itemTotals([
          { unitPrice: 35_000, quantity: 1 },
          { unitPrice: null, quantity: 3 },
        ]),
      ),
    ).toBe("Rp35.000+");
    expect(formatSubtotal(itemTotals([{ unitPrice: null, quantity: 2 }]))).toBe("—");
    expect(formatSubtotal(itemTotals([]))).toBe("—");
  });

  it("keeps money an integer", () => {
    const { subtotal } = itemTotals([
      { unitPrice: 33_333, quantity: 3 },
      { unitPrice: 1, quantity: 50 },
    ]);
    expect(subtotal).toBe(100_049);
    expect(Number.isInteger(subtotal)).toBe(true);
  });
});

// M2.5 K6, M2 plan D18 (phone display) and D19 (chat link greeting).
describe("formatPhone (M2.5 K6, D18)", () => {
  it("0 + the digits after 62, grouped 4-4-rest", () => {
    expect(formatPhone("6281234567890")).toBe("0812-3456-7890"); // 13 digits, the D18 example
    expect(formatPhone("6281234567")).toBe("0812-3456-7"); // 10 digits, the shortest the checkout accepts
    expect(formatPhone("628123456789012")).toBe("0812-3456-789012"); // 15 digits, the longest
  });
});

describe("chatUrl and chatGreeting (M2.5 K6, D19)", () => {
  const GREETING = "Halo kak, ini Kagumi Dough soal pesanan KD-0123 dari website.";

  it("the greeting names the order number in the KD-0123 form", () => {
    expect(chatGreeting(123)).toBe(GREETING);
    expect(chatGreeting(12345)).toBe("Halo kak, ini Kagumi Dough soal pesanan KD-12345 dari website.");
  });

  it("is wa.me/<customer number>?text= + the encoded greeting, for 10-, 13- and 15-digit numbers", () => {
    for (const phone of ["6281234567", "6281234567890", "628123456789012"]) {
      expect(chatUrl(phone, GREETING)).toBe(`https://wa.me/${phone}?text=${encodeURIComponent(GREETING)}`);
      const url = new URL(chatUrl(phone, GREETING));
      expect(url.pathname).toBe(`/${phone}`);
      expect(url.searchParams.get("text")).toBe(GREETING);
    }
    expect(chatUrl("6281234567890", GREETING)).toContain("Halo%20kak%2C%20ini%20Kagumi%20Dough%20soal%20pesanan%20KD-0123");
  });

  it("goes to the customer, not the shop", () => {
    expect(chatUrl("6281234567890", GREETING)).not.toContain(SHOP_WHATSAPP);
  });

  it("does not throw on a lone surrogate (same encoding as whatsappUrl)", () => {
    expect(() => chatUrl("6281234567890", "a\uD800b")).not.toThrow();
  });
});
