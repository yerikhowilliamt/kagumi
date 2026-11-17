// Product data the storefront page hands to its components (D9). No imports: client components use this file.

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
