// The checkout transaction behind createOrder (System Design §4.3, milestone plan D2, D5, D17).
// Server only. The client never supplies names or prices: they are read from the database.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { buildOrderMessage, formatOrderNumber, isClosed, jakartaToday, whatsappUrl, type OrderLine } from "./order";
import { hitRateLimit, visitorHash as hashVisitor } from "./tracking";
import { checkoutSchema, type CheckoutInput } from "./validation";

export const CHECKOUT_LIMIT = 5; // per visitor per 10 minutes (System Design §9)

export type CreateOrderResult =
  | { ok: true; orderNumber: string; waUrl: string }
  | { ok: false; error: "validation"; fields: Partial<Record<keyof CheckoutInput, string>> }
  | { ok: false; error: "rate_limited" }
  | { ok: false; error: "rejected"; lines: { productId: string; reason: "closed" | "unavailable" }[] }
  | { ok: false; error: "server" };

/** Steps 1–5 of System Design §4.3 inside `tx`. A returned result commits; only a throw rolls back. */
export async function placeOrder(
  tx: Prisma.TransactionClient,
  input: unknown,
  { visitorHash, now }: { visitorHash: string; now: Date },
): Promise<CreateOrderResult> {
  const today = jakartaToday(now);
  const parsed = checkoutSchema(today).safeParse(input);
  if (!parsed.success) {
    const fields: Partial<Record<keyof CheckoutInput, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof CheckoutInput | undefined;
      if (typeof key === "string" && !fields[key]) fields[key] = issue.message;
    }
    return { ok: false, error: "validation", fields };
  }
  const data = parsed.data;

  // After validation, so invalid input doesn't count; before the products, so a rejected cart does (D5).
  if (!(await hitRateLimit(tx, `checkout:${visitorHash}`, now, CHECKOUT_LIMIT))) return { ok: false, error: "rate_limited" };

  const products = await tx.product.findMany({
    where: { id: { in: data.items.map((item) => item.productId) } },
    select: { id: true, name: true, price: true, isActive: true, orderDeadline: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  type Rejected = Extract<CreateOrderResult, { error: "rejected" }>["lines"];
  const rejected = data.items.flatMap(({ productId }): Rejected => {
    const p = byId.get(productId);
    if (!p || !p.isActive) return [{ productId, reason: "unavailable" }];
    if (isClosed(p.orderDeadline && p.orderDeadline.toISOString().slice(0, 10), today)) return [{ productId, reason: "closed" }];
    return [];
  });
  if (rejected.length) return { ok: false, error: "rejected", lines: rejected };

  const lines: OrderLine[] = data.items.map(({ productId, quantity }) => {
    const p = byId.get(productId)!;
    return { name: p.name, unitPrice: p.price, quantity };
  });
  const order = await tx.order.create({
    data: {
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      fulfillment: data.fulfillment,
      address: data.address,
      requestedDate: new Date(`${data.requestedDate}T00:00:00Z`),
      note: data.note,
      items: {
        create: data.items.map(({ productId }, i) => ({
          productId,
          productName: lines[i].name,
          unitPrice: lines[i].unitPrice,
          quantity: lines[i].quantity,
        })),
      },
      statusChanges: { create: { fromStatus: null, toStatus: "NEW" } },
    },
    select: { id: true },
  });
  await tx.event.create({ data: { type: "CHECKOUT", visitorHash } });

  const orderNumber = formatOrderNumber(order.id);
  return { ok: true, orderNumber, waUrl: whatsappUrl(buildOrderMessage({ orderNumber, lines, customer: data })) };
}

/** Runs placeOrder in one transaction. Any throw becomes `server`, logged without input values (D2). */
export async function checkout(
  client: Pick<PrismaClient, "$transaction">,
  input: unknown,
  ctx: { ip: string; ua: string; secret: string | undefined; now: Date },
): Promise<CreateOrderResult> {
  try {
    const visitorHash = hashVisitor(ctx);
    // maxWait: a new Neon connection can take longer than Prisma's 2 s default (TD-007).
    return await client.$transaction((tx) => placeOrder(tx, input, { visitorHash, now: ctx.now }), { maxWait: 10_000 });
  } catch (error) {
    const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
    console.error("[createOrder] failed", String(name ?? "Error"), String(code ?? ""));
    return { ok: false, error: "server" };
  }
}
