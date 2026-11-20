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

/** The WIB clock time of an instant as "14.32" (M1-D23). */
export const formatJakartaTime = (instant: Date) =>
  new Date(instant.getTime() + 7 * 3_600_000).toISOString().slice(11, 16).replace(":", ".");

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

/** "2026-12-20" → "20 Des 2026" */
export function formatDateMedium(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  return `${day} ${MONTHS_SHORT[month - 1]} ${year}`;
}

/** When an order came in, in WIB (M2 plan D16): "Hari ini, 14.20", "Kemarin, 19.42", "12 Nov, 16.10", "12 Nov 2025, 16.10". */
export function formatWhen(instant: Date, now: Date) {
  const day = jakartaToday(instant);
  const today = jakartaToday(now);
  const yesterday = jakartaToday(new Date(now.getTime() - 86_400_000));
  const time = formatJakartaTime(instant);
  if (day === today) return `Hari ini, ${time}`;
  if (day === yesterday) return `Kemarin, ${time}`;
  return `${day.slice(0, 4) === today.slice(0, 4) ? formatDateShort(day) : formatDateMedium(day)}, ${time}`;
}

/** An order's item count (sum of quantities, X5), the subtotal of its priced lines, and the quantity without a price. */
export function itemTotals(lines: { unitPrice: number | null; quantity: number }[]) {
  let quantity = 0;
  let subtotal = 0;
  let unpriced = 0;
  for (const line of lines) {
    quantity += line.quantity;
    if (line.unitPrice === null) unpriced += line.quantity;
    else subtotal += line.unitPrice * line.quantity;
  }
  return { quantity, subtotal, unpriced };
}

/** "Rp70.000" when every item is priced, "Rp35.000+" when some are not, "—" when none are. */
export const formatSubtotal = ({ quantity, subtotal, unpriced }: ReturnType<typeof itemTotals>) =>
  unpriced === quantity ? "—" : `${formatRupiah(subtotal)}${unpriced > 0 ? "+" : ""}`;

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

// A lone UTF-16 surrogate makes encodeURIComponent throw (TR-M1.1-01): it becomes U+FFFD, pairs are kept.
// A regex without lookbehind or toWellFormed(), so older Safari can run the fallback too.
const wellFormed = (text: string) =>
  text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (c) => (c.length === 2 ? c : "�"));

export const whatsappUrl = (message: string) =>
  `https://wa.me/${SHOP_WHATSAPP}?text=${encodeURIComponent(wellFormed(message))}`;

/** A stored number "6281234567890" as the admin reads it: "0812-3456-7890" (`0` + the digits after `62`, 4-4-rest). */
export function formatPhone(stored: string) {
  if (!stored.startsWith("62")) return stored;
  const local = `0${stored.slice(2)}`;
  return [local.slice(0, 4), local.slice(4, 8), local.slice(8)].filter(Boolean).join("-");
}

/** The admin's chat greeting (M2 plan D19): it names the order number and never the customer. */
export const chatGreeting = (id: number) => `Halo kak, ini Kagumi Dough soal pesanan ${formatOrderNumber(id)} dari website.`;

/** A chat with the customer's number, encoded like whatsappUrl. */
export const chatUrl = (phone: string, message: string) =>
  `https://wa.me/${phone}?text=${encodeURIComponent(wellFormed(message))}`;
