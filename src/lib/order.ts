// Order rules shared by the browser and the server. Client components import this file,
// so it imports nothing. Dates and money are formatted from fixed tables, not from the
// runtime's locale data, so both sides produce the same bytes.

export const SHOP_WHATSAPP = "6285159545168";

// Cart limits (System Design §9). Here, not in validation.ts, so the storefront steppers read them without zod.
export const MAX_LINES = 20;
export const MAX_QTY = 50;

export type OrderLine = { name: string; unitPrice: number | null; quantity: number };

export type OrderCustomer = {
  customerName: string;
  fulfillment: "PICKUP" | "DELIVERY";
  address?: string | null;
  requestedDate: string; // "YYYY-MM-DD"
  note?: string | null;
};

const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export const formatOrderNumber = (id: number) => `KD-${String(id).padStart(4, "0")}`;

export const formatRupiah = (amount: number) => `Rp${String(amount).replace(/\B(?=(\d{3})+$)/g, ".")}`;

/** The calendar date in WIB as "YYYY-MM-DD". WIB is UTC+7 with no daylight saving. */
export const jakartaToday = (now: Date = new Date()) =>
  new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

/** `deadline` ("YYYY-MM-DD" or null) is the last day orders are accepted, so that day is still open. */
export const isClosed = (deadline: string | null, today: string) => deadline !== null && deadline < today;

/** "2026-12-20" → "Minggu, 20 Desember 2026" */
export function formatDateLong(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  return `${DAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}, ${day} ${MONTHS[month - 1]} ${year}`;
}

/** "2026-12-10" → "10 Des" */
export function formatDateShort(ymd: string) {
  const [, month, day] = ymd.split("-").map(Number);
  return `${day} ${MONTHS_SHORT[month - 1]}`;
}

/** Subtotal of the priced lines, and how many lines have no price. */
export function summarize(lines: OrderLine[]) {
  let subtotal = 0;
  let unpriced = 0;
  for (const line of lines) {
    if (line.unitPrice === null) unpriced += 1;
    else subtotal += line.unitPrice * line.quantity;
  }
  return { subtotal, unpriced };
}

/** The WhatsApp message of System Design §4.3. Without `orderNumber` it is the fallback message. */
export function buildOrderMessage({
  orderNumber,
  lines,
  customer,
}: {
  orderNumber?: string;
  lines: OrderLine[];
  customer: OrderCustomer;
}) {
  const { subtotal, unpriced } = summarize(lines);
  const delivery = customer.fulfillment === "DELIVERY";
  const note = customer.note?.trim();
  return [
    "Halo Kagumi Dough! Aku mau pesan (dari website)",
    "",
    ...(orderNumber ? [`No. pesanan: ${orderNumber}`] : []),
    ...lines.map(
      ({ name, unitPrice, quantity }) =>
        `• ${quantity}× ${name} — ${unitPrice === null ? "harga via WA" : formatRupiah(unitPrice * quantity)}`,
    ),
    "",
    unpriced === lines.length
      ? "Subtotal: harga via WA"
      : `Subtotal: ${formatRupiah(subtotal)}${unpriced ? ` (+ ${unpriced} produk harga via WA)` : ""}`,
    `Nama: ${customer.customerName.trim()}`,
    `Pengambilan: ${delivery ? "Diantar" : "Ambil sendiri"}`,
    ...(delivery ? [`Alamat: ${(customer.address ?? "").trim()}`] : []),
    `Tanggal: ${formatDateLong(customer.requestedDate)}`,
    ...(note ? [`Catatan: ${note}`] : []),
  ].join("\n");
}

export const whatsappUrl = (message: string) => `https://wa.me/${SHOP_WHATSAPP}?text=${encodeURIComponent(message)}`;
