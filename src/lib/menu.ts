// Product data the storefront page hands to its components (D9), and the menu rules that depend on today's date.
// Client components use this file: it imports only ./order, which imports nothing (D17).
import { isClosed } from "./order";

const TONES = ["butter", "pink", "sky", "mint"] as const;

export type StoreMedia = {
  publicId: string;
  kind: "IMAGE" | "VIDEO";
  version: number;
  format: string;
  width: number;
  height: number;
  durationSec: number | null;
  isMain: boolean;
};

export type StoreProduct = {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number | null;
  type: "PRE_ORDER" | "READY_STOCK";
  /** `YYYY-MM-DD`, comparable with `jakartaToday()`. */
  orderDeadline: string | null;
  /** Placeholder fill, by menu position. */
  tone: (typeof TONES)[number];
  /** The main one first, then by sortOrder. Empty until M3. */
  media: StoreMedia[];
};

type ProductRow = Omit<StoreProduct, "orderDeadline" | "tone" | "media"> & {
  orderDeadline: Date | null;
  media: (StoreMedia & { sortOrder: number })[];
};

export function toStoreProduct(row: ProductRow, index: number): StoreProduct {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    price: row.price,
    type: row.type,
    // A `date` column arrives as UTC midnight.
    orderDeadline: row.orderDeadline ? row.orderDeadline.toISOString().slice(0, 10) : null,
    tone: TONES[index % TONES.length],
    media: row.media
      .toSorted((a, b) => Number(b.isMain) - Number(a.isMain) || a.sortOrder - b.sortOrder)
      .map(({ publicId, kind, version, format, width, height, durationSec, isMain }) => ({
        publicId,
        kind,
        version,
        format,
        width,
        height,
        durationSec,
        isMain,
      })),
  };
}

export type MenuFilter = "ALL" | StoreProduct["type"];

// Every function below takes the products in sortOrder, as the page reads them, and `today` as `jakartaToday()`.

/** Open products in their order, then closed ones in their order (FR5). */
export function sortForMenu(products: StoreProduct[], today: string) {
  const closed = (p: StoreProduct) => isClosed(p.orderDeadline, today);
  return [...products.filter((p) => !closed(p)), ...products.filter(closed)];
}

/** Closed products stay listed under their type (FR4). */
export const filterMenu = (products: StoreProduct[], filter: MenuFilter) =>
  filter === "ALL" ? products : products.filter((p) => p.type === filter);

const openPreOrders = (products: StoreProduct[], today: string) =>
  products.filter((p) => p.type === "PRE_ORDER" && !isClosed(p.orderDeadline, today));

export const hasOpenPreOrder = (products: StoreProduct[], today: string) => openPreOrders(products, today).length > 0;

/** The open pre-order with the nearest deadline; those without a deadline come after; ties keep sortOrder. */
export function promoProduct(products: StoreProduct[], today: string): StoreProduct | null {
  const open = openPreOrders(products, today);
  // `YYYY-MM-DD` strings compare as dates. The first of equal deadlines wins, so sortOrder breaks ties.
  const dated = open.filter((p) => p.orderDeadline !== null);
  if (dated.length === 0) return open[0] ?? null;
  return dated.reduce((nearest, p) => (p.orderDeadline! < nearest.orderDeadline! ? p : nearest));
}

/** `empty`: no active product at all. `no-match`: the filter has none (D8). */
export const menuState = (products: StoreProduct[], filter: MenuFilter) =>
  products.length === 0 ? "empty" : filterMenu(products, filter).length === 0 ? "no-match" : "list";
