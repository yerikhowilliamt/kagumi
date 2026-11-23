import type { Prisma } from "@/generated/prisma/client";
import { isClosed } from "./order";

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
      media: { select: { kind: true } },
    },
  });
  return rows.map(({ media, orderDeadline, ...row }) => {
    // A `date` column arrives as UTC midnight.
    const deadline = orderDeadline ? orderDeadline.toISOString().slice(0, 10) : null;
    return {
      ...row,
      orderDeadline: deadline,
      closed: isClosed(deadline, today),
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
