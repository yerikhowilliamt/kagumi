import type { Prisma } from "@/generated/prisma/client";
import { itemTotals } from "./order";

// Admin order queries. Server only; every function takes the client, so tests pass a rolled-back transaction.
type Client = Prisma.TransactionClient;

/**
 * The status bar counts of D17 (System Design §4.9). `today` is the WIB date "YYYY-MM-DD" (jakartaToday): a
 * pre-order is open while its deadline is null or not before today, the rule of isClosed.
 */
export async function statusBarCounts(client: Client, today: string) {
  const [newOrders, openPreOrders] = await Promise.all([
    client.order.count({ where: { status: "NEW" } }),
    client.product.count({
      where: {
        isActive: true,
        type: "PRE_ORDER",
        OR: [{ orderDeadline: null }, { orderDeadline: { gte: new Date(`${today}T00:00:00Z`) } }],
      },
    }),
  ]);
  return { newOrders, openPreOrders };
}

// The order list of M2 plan D5, D16 (System Design §4.9): `/admin/pesanan?status=NEW&q=rina&page=2`.
export const ORDER_STATUSES = ["NEW", "CONFIRMED", "COMPLETED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderQuery = { status: OrderStatus | null; q: string; page: number };

export const PAGE_SIZE = 50;
const Q_MAX = 80;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** An unknown status means all; q is trimmed and cut to 80 characters; page is an integer ≥ 1, otherwise 1. */
export function parseOrderQuery(params: Record<string, string | string[] | undefined>): OrderQuery {
  const status = first(params.status);
  const page = first(params.page);
  return {
    status: (ORDER_STATUSES as readonly string[]).includes(status) ? (status as OrderStatus) : null,
    q: first(params.q).trim().slice(0, Q_MAX).trim(),
    page: /^[1-9]\d{0,8}$/.test(page) ? Number(page) : 1,
  };
}

/** The order id a search names: `KD-0123`, `kd-123`, `#KD-0123`, `0123` and `123` are all 123; anything else is null. */
export function orderIdFromSearch(q: string) {
  const match = /^#?(?:KD-?)?0*(\d{1,9})$/i.exec(q);
  return match ? Number(match[1]) : null;
}

/** The list URL for a filter, search and page, leaving out the defaults. */
export function orderListHref({ status, q, page }: OrderQuery) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/admin/pesanan?${search}` : "/admin/pesanan";
}

/** One page of orders, newest first, with each order's item totals. A page past the last returns the last. */
export async function listOrders(client: Client, { status, q, page }: OrderQuery) {
  const id = q ? orderIdFromSearch(q) : null;
  const where: Prisma.OrderWhereInput = {
    ...(status && { status }),
    ...(q && {
      // Prisma's contains does not escape LIKE wildcards (claim C6 was false), so %, _ and \ are escaped here.
      OR: [
        { customerName: { contains: q.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" } },
        ...(id !== null ? [{ id }] : []),
      ],
    }),
  };
  const total = await client.order.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const orders = await client.order.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (current - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      createdAt: true,
      customerName: true,
      fulfillment: true,
      requestedDate: true,
      status: true,
      items: { select: { unitPrice: true, quantity: true } },
    },
  });
  const rows = orders.map(({ items, requestedDate, ...order }) => ({
    ...order,
    requestedDate: requestedDate.toISOString().slice(0, 10),
    ...itemTotals(items),
  }));
  return { rows, total, page: current, pageCount };
}

/** The chip counts: every order by status, and all of them, regardless of the search (one GROUP BY). */
export async function statusCounts(client: Client) {
  const counts = { all: 0, NEW: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 };
  for (const group of await client.order.groupBy({ by: ["status"], _count: { _all: true } })) {
    counts[group.status] = group._count._all;
    counts.all += group._count._all;
  }
  return counts;
}
