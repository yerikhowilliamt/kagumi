import type { Prisma } from "@/generated/prisma/client";
import { isClosed } from "./order";
import type { ProductData } from "./validation";

// Admin product queries (M3 plan D13, D14, D23). Server only; every function takes the client, so tests pass a
// rolled-back transaction.
type Client = Prisma.TransactionClient;

export const PRODUCT_FILTERS = ["READY_STOCK", "PRE_ORDER", "HIDDEN"] as const;
export type ProductFilter = (typeof PRODUCT_FILTERS)[number] | null;

/** `?filter=READY_STOCK`, `PRE_ORDER` or `HIDDEN`; anything else (or nothing) means all. */
export function parseProductFilter(params: Record<string, string | string[] | undefined>): ProductFilter {
  const value = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  return (PRODUCT_FILTERS as readonly (string | undefined)[]).includes(value) ? (value as ProductFilter) : null;
}

const whereOf = (filter: ProductFilter): Prisma.ProductWhereInput =>
  filter === "HIDDEN" ? { isActive: false } : filter ? { type: filter } : {};

/**
 * Every product of the filter in the storefront's order (`sortOrder`, then `id`), with its photo and video counts and
 * whether its deadline is before `today` (the WIB date "YYYY-MM-DD", the rule of isClosed). A type filter includes
 * hidden products.
 */
export async function listProducts(client: Client, filter: ProductFilter, today: string) {
  const rows = await client.product.findMany({
    where: whereOf(filter),
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      category: true,
      price: true,
      type: true,
      orderDeadline: true,
      isActive: true,
      // Display order (D11), so the list thumb is the main photo.
      media: { select: { kind: true, publicId: true, version: true }, orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }, { id: "asc" }] },
    },
  });
  return rows.map(({ media, orderDeadline, ...row }) => {
    // A `date` column arrives as UTC midnight.
    const deadline = orderDeadline ? orderDeadline.toISOString().slice(0, 10) : null;
    return {
      ...row,
      orderDeadline: deadline,
      closed: isClosed(deadline, today),
      media,
      photos: media.filter((m) => m.kind === "IMAGE").length,
      videos: media.filter((m) => m.kind === "VIDEO").length,
    };
  });
}

/** The chip counts over all products: the type counts include hidden products, `HIDDEN` counts `isActive = false`. */
export async function productCounts(client: Client) {
  const counts = { all: 0, READY_STOCK: 0, PRE_ORDER: 0, HIDDEN: 0 };
  for (const group of await client.product.groupBy({ by: ["type", "isActive"], _count: { _all: true } })) {
    counts[group.type] += group._count._all;
    counts.all += group._count._all;
    if (!group.isActive) counts.HIDDEN += group._count._all;
  }
  return counts;
}

/** Shows or hides one product. `changed` is false when it already had that state. */
export async function setActive(client: Client, id: string, active: boolean) {
  const { count } = await client.product.updateMany({ where: { id, isActive: !active }, data: { isActive: active } });
  if (count > 0) return { found: true, changed: true } as const;
  const exists = await client.product.count({ where: { id } });
  return exists ? ({ found: true, changed: false } as const) : ({ found: false } as const);
}

// A `date` column arrives as UTC midnight and is written the same way.
const toDate = (ymd: string | null) => (ymd ? new Date(`${ymd}T00:00:00Z`) : null);
const toYmd = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

/** One product's form fields (FR22), or null when the id has no row. */
export async function getProduct(client: Client, id: string) {
  const row = await client.product.findUnique({
    where: { id },
    select: { id: true, name: true, category: true, description: true, price: true, type: true, orderDeadline: true, isActive: true, sortOrder: true },
  });
  return row && { ...row, orderDeadline: toYmd(row.orderDeadline) };
}

/** The existing categories, each once and sorted: the form's suggestions (M3 plan D12). */
export async function categories(client: Client) {
  const rows = await client.product.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } });
  return rows.map((row) => row.category);
}

/** A new product's display order: after the last one (current maximum + 1), capped at the form's 9999 (D12). */
export async function nextSortOrder(client: Client) {
  const { _max } = await client.product.aggregate({ _max: { sortOrder: true } });
  return _max.sortOrder === null ? 0 : Math.min(_max.sortOrder + 1, 9999);
}

export async function createProductRow(client: Client, input: ProductData) {
  const { id } = await client.product.create({ data: { ...input, orderDeadline: toDate(input.orderDeadline) }, select: { id: true } });
  return id;
}

/** False when the id has no row. */
export async function updateProductRow(client: Client, id: string, input: ProductData) {
  const { count } = await client.product.updateMany({ where: { id }, data: { ...input, orderDeadline: toDate(input.orderDeadline) } });
  return count > 0;
}

export type QueuedAsset = { publicId: string; kind: "IMAGE" | "VIDEO" };

/**
 * D4, FR27 step 1, inside the caller's transaction: locks the product row, queues every medium in pending_deletions and
 * deletes the product (its media rows cascade; order lines and events keep their rows with product_id null). Returns
 * the queued assets, or null when the id has no row. The lock keeps a concurrent upload (M3.4) from adding a medium that
 * would cascade away unqueued.
 */
export async function deleteProductRow(tx: Client, id: string): Promise<QueuedAsset[] | null> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM products WHERE id = ${id}::uuid FOR UPDATE`;
  if (locked.length === 0) return null;
  const media = await tx.productMedia.findMany({ where: { productId: id }, select: { publicId: true, kind: true } });
  // skipDuplicates: an asset already queued (a failed earlier attempt) keeps its row, attempts and last_error.
  if (media.length > 0) await tx.pendingDeletion.createMany({ data: media, skipDuplicates: true });
  await tx.product.delete({ where: { id } });
  return media;
}

/**
 * D4 step 2, after the commit: destroys each queued asset; on success its queue row is deleted, on failure `attempts`
 * goes up by one and `last_error` holds the error's message (status and Cloudinary's text, never a secret). The daily
 * cron retries what is left. Returns the number of failures.
 */
export async function processDeletions(
  client: Client,
  assets: QueuedAsset[],
  destroy: (publicId: string, kind: QueuedAsset["kind"]) => Promise<unknown>,
) {
  let failed = 0;
  for (const { publicId, kind } of assets) {
    try {
      await destroy(publicId, kind);
    } catch (error) {
      failed += 1;
      const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await client.pendingDeletion.updateMany({ where: { publicId }, data: { attempts: { increment: 1 }, lastError } });
      continue;
    }
    await client.pendingDeletion.deleteMany({ where: { publicId } });
  }
  return failed;
}

// Media (M3 plan D2, D4, D11). Each mutation runs in the caller's transaction and first locks the product row, so
// several uploads to one product (a phone picker sends three files at once) read the main photo and the next
// sortOrder one at a time.
const MEDIA_FIELDS = {
  id: true,
  publicId: true,
  kind: true,
  version: true,
  format: true,
  width: true,
  height: true,
  bytes: true,
  durationSec: true,
  isMain: true,
  sortOrder: true,
} as const;

/** A product's media in display order (D11): the main one first, then sortOrder, as the storefront shows them. */
export async function listMedia(client: Client, productId: string) {
  return client.productMedia.findMany({
    where: { productId },
    orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
    select: MEDIA_FIELDS,
  });
}

export type AdminMedia = Awaited<ReturnType<typeof listMedia>>[number];
export type NewMedia = Omit<AdminMedia, "id" | "isMain" | "sortOrder">;

/** Numbers the media after the main one 0..n-1 in the given order, so no sortOrder is shared (D11, BSA-M3.4-02). */
async function renumber(tx: Client, others: { id: string; sortOrder: number }[]) {
  for (const [sortOrder, m] of others.entries()) {
    if (m.sortOrder !== sortOrder) await tx.productMedia.update({ where: { id: m.id }, data: { sortOrder } });
  }
}

const lockProduct = async (tx: Client, id: string) =>
  (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM products WHERE id = ${id}::uuid FOR UPDATE`).length > 0;

/**
 * D11 new medium: sortOrder = the product's maximum + 1; an image becomes main when the product has no main one (its
 * first image). `not_found` when the product has no row, `duplicate` when the public_id is already saved (a replayed
 * response: its asset is in use and must not be destroyed).
 */
export async function addMediaRow(tx: Client, productId: string, media: NewMedia): Promise<AdminMedia | "not_found" | "duplicate"> {
  if (!(await lockProduct(tx, productId))) return "not_found";
  if ((await tx.productMedia.count({ where: { publicId: media.publicId } })) > 0) return "duplicate";
  const { _max } = await tx.productMedia.aggregate({ where: { productId }, _max: { sortOrder: true } });
  const isMain = media.kind === "IMAGE" && (await tx.productMedia.count({ where: { productId, isMain: true } })) === 0;
  return tx.productMedia.create({
    data: { ...media, productId, isMain, sortOrder: _max.sortOrder === null ? 0 : _max.sortOrder + 1 },
    select: MEDIA_FIELDS,
  });
}

/**
 * D11 "Jadikan utama": only an image; the old main is cleared first (the partial unique index allows one), then the
 * others are renumbered in display order, so the old main can't share a sortOrder with another medium.
 */
export async function setMainRow(tx: Client, productId: string, mediaId: string): Promise<"ok" | "unchanged" | "not_found" | "video"> {
  if (!(await lockProduct(tx, productId))) return "not_found";
  const media = await tx.productMedia.findFirst({ where: { id: mediaId, productId }, select: { kind: true, isMain: true } });
  if (!media) return "not_found";
  if (media.kind !== "IMAGE") return "video";
  if (media.isMain) return "unchanged";
  await tx.productMedia.updateMany({ where: { productId, isMain: true }, data: { isMain: false } });
  await tx.productMedia.update({ where: { id: mediaId }, data: { isMain: true } });
  await renumber(tx, (await listMedia(tx, productId)).filter((m) => !m.isMain));
  return "ok";
}

/**
 * D11 move: swaps the medium with its neighbour among the media after the main one, in display order. The others are
 * numbered 0..n-1 in that order, so equal sortOrders can't make the swap a no-op. `invalid` for the main medium or a
 * move past either end.
 */
export async function moveRow(tx: Client, productId: string, mediaId: string, direction: "left" | "right"): Promise<"ok" | "not_found" | "invalid"> {
  if (!(await lockProduct(tx, productId))) return "not_found";
  const all = await listMedia(tx, productId);
  const media = all.find((m) => m.id === mediaId);
  if (!media) return "not_found";
  const others = all.filter((m) => !m.isMain);
  const from = others.indexOf(media);
  const to = from + (direction === "left" ? -1 : 1);
  if (media.isMain || to < 0 || to >= others.length) return "invalid";
  [others[from], others[to]] = [others[to], others[from]];
  await renumber(tx, others);
  return "ok";
}

/**
 * D4 + D11 delete, inside the caller's transaction: queues the asset, deletes the row and, when it was the main one,
 * makes the next image in display order main (none left: no main). Returns the queued asset, or null when the product
 * or the medium (of that product) has no row.
 */
export async function deleteMediaRow(tx: Client, productId: string, mediaId: string): Promise<QueuedAsset | null> {
  if (!(await lockProduct(tx, productId))) return null;
  const media = await tx.productMedia.findFirst({ where: { id: mediaId, productId }, select: { publicId: true, kind: true, isMain: true } });
  if (!media) return null;
  const asset = { publicId: media.publicId, kind: media.kind };
  await tx.pendingDeletion.createMany({ data: [asset], skipDuplicates: true });
  await tx.productMedia.delete({ where: { id: mediaId } });
  if (media.isMain) {
    const next = await tx.productMedia.findFirst({ where: { productId, kind: "IMAGE" }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true } });
    if (next) await tx.productMedia.update({ where: { id: next.id }, data: { isMain: true } });
  }
  return asset;
}
