"use server";
// Every export of this file is an endpoint (M2 plan D15, D23): only setOrderStatus, behind requireAdmin().
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { ORDER_STATUSES, changeOrderStatus, type OrderStatus } from "@/lib/orders";

export type SetStatusResult = { ok: true; changed: boolean } | { ok: false; error: "validation" | "not_found" | "server" };

const input = z.object({ orderId: z.int().min(1).max(2_147_483_647), status: z.enum(ORDER_STATUSES) });

export async function setOrderStatus(orderId: number, status: OrderStatus): Promise<SetStatusResult> {
  await requireAdmin();
  // The types are the contract; the values come from the network, so they are checked again.
  const parsed = input.safeParse({ orderId, status });
  if (!parsed.success) return { ok: false, error: "validation" };
  let result;
  try {
    result = await db.$transaction((tx) => changeOrderStatus(tx, parsed.data.orderId, parsed.data.status), {
      maxWait: 10_000, // opening a Neon connection can take longer than Prisma's 2 s default (ERR-003)
    });
  } catch (error) {
    // Name and code only: a driver message could quote order data.
    const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
    console.error("[setOrderStatus] failed", String(name ?? "Error"), String(code ?? ""));
    return { ok: false, error: "server" };
  }
  // The status bar, the nav pill and the list live under the admin layout. The storefront is unaffected (§4.9).
  if (result.ok && result.changed) revalidatePath("/admin", "layout");
  return result;
}
