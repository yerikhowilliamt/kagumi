// The checkout input rules, shared by the checkout form and createOrder.
// Client components import this file: it may import only zod and ./order.
import { z } from "zod";

export const MAX_LINES = 20;
export const MAX_QTY = 50;

const NAME_REQUIRED = "Nama wajib diisi.";
const NAME_MAX = "Nama maksimal 80 karakter.";
const PHONE = "Isi nomor WhatsApp yang benar, contoh 0812-3456-7890.";
const FULFILLMENT = "Pilih ambil sendiri atau diantar.";
const ADDRESS_REQUIRED = "Alamat wajib diisi untuk pengantaran.";
const ADDRESS_MAX = "Alamat maksimal 300 karakter.";
const DATE_REQUIRED = "Pilih tanggal pesanan.";
const DATE_PAST = "Tanggal tidak boleh sebelum hari ini.";
const NOTE_MAX = "Catatan maksimal 500 karakter.";
const ITEMS = "Keranjang tidak valid. Muat ulang halaman lalu coba lagi.";

/** What createOrder receives (the contract of the checkout form). */
export type CheckoutInput = {
  customerName: string;
  customerPhone: string;
  fulfillment: "PICKUP" | "DELIVERY";
  address?: string;
  requestedDate: string; // "YYYY-MM-DD"
  note?: string;
  items: { productId: string; quantity: number }[];
};

/**
 * "0812-3456-7890", "+62 812 3456 7890" or "6281234567890" → "6281234567890".
 * Null when it is not an Indonesian mobile number of 10–15 digits (System Design §9).
 */
export function normalizePhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-.()]/g, "");
  const digits = compact.startsWith("+628") ? compact.slice(1) : compact.startsWith("08") ? `62${compact.slice(1)}` : compact;
  return /^628\d{7,12}$/.test(digits) ? digits : null;
}

/** `today` is the caller's date in WIB ("YYYY-MM-DD"): the browser and the server each pass their own. */
export function checkoutSchema(today: string) {
  const shared = {
    customerName: z.string(NAME_REQUIRED).trim().min(1, NAME_REQUIRED).max(80, NAME_MAX),
    customerPhone: z.string(PHONE).transform((raw, ctx) => {
      const phone = normalizePhone(raw);
      if (phone === null) {
        ctx.issues.push({ code: "custom", message: PHONE, input: raw });
        return z.NEVER;
      }
      return phone;
    }),
    // abort: a value that is not a date gets one message, not also the "before today" one.
    requestedDate: z.iso.date({ error: DATE_REQUIRED, abort: true }).refine((date) => date >= today, DATE_PAST),
    note: z
      .string(NOTE_MAX)
      .trim()
      .max(500, NOTE_MAX)
      .optional()
      .transform((note) => note || null),
    items: z
      .array(
        z.object(
          { productId: z.uuid(ITEMS), quantity: z.number(ITEMS).int(ITEMS).min(1, ITEMS).max(MAX_QTY, ITEMS) },
          ITEMS,
        ),
        ITEMS,
      )
      .min(1, ITEMS)
      .max(MAX_LINES, ITEMS)
      .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, ITEMS),
  };
  return z.discriminatedUnion(
    "fulfillment",
    [
      // Pickup has no address: whatever was sent is dropped with the other unknown keys.
      z.object({ ...shared, fulfillment: z.literal("PICKUP") }).transform((order) => ({ ...order, address: null })),
      z.object({
        ...shared,
        fulfillment: z.literal("DELIVERY"),
        address: z.string(ADDRESS_REQUIRED).trim().min(1, ADDRESS_REQUIRED).max(300, ADDRESS_MAX),
      }),
    ],
    FULFILLMENT,
  );
}

/** A valid checkout in the form the order is stored in. */
export type CheckoutData = z.output<ReturnType<typeof checkoutSchema>>;
