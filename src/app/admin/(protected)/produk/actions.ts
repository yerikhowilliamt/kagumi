"use server";
// Every export of this file is an endpoint (M3 plan D13, D23), each behind requireAdmin().
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { setActive } from "@/lib/products";

type Fail = { ok: false; error: "validation" | "not_found" | "server" };

const activeInput = z.object({ productId: z.uuid(), active: z.boolean() });

/** Name and code only: a driver message could quote product data. */
function logFailure(action: string, error: unknown) {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
  console.error(`[${action}] failed`, String(name ?? "Error"), String(code ?? ""));
}

/**
 * D9: the storefront list (tag `products`, expired at once so the owner sees the change on the next request) and the
 * admin layout (the status bar's "n PO aktif" and the products list).
 */
function revalidateProducts() {
  updateTag("products");
  revalidatePath("/admin", "layout");
}

/** FR22 show/hide (M3 plan D13, D14): a hidden product leaves the storefront and checkout rejects it (FR7). */
export async function setProductActive(productId: string, active: boolean): Promise<{ ok: true } | Fail> {
  await requireAdmin();
  // The types are the contract; the values come from the network, so they are checked again.
  const parsed = activeInput.safeParse({ productId, active });
  if (!parsed.success) return { ok: false, error: "validation" };
  let result;
  try {
    result = await setActive(db, parsed.data.productId, parsed.data.active);
  } catch (error) {
    logFailure("setProductActive", error);
    return { ok: false, error: "server" };
  }
  if (!result.found) return { ok: false, error: "not_found" };
  if (result.changed) revalidateProducts();
  return { ok: true };
}
