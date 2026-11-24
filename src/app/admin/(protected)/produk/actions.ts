"use server";
// Every export of this file is an endpoint (M3 plan D13, D23), each behind requireAdmin().
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { createProductRow, setActive, updateProductRow } from "@/lib/products";
import { productInput, type ProductData, type ProductField } from "@/lib/validation";

type Fail = { ok: false; error: "validation" | "not_found" | "server" };
export type ProductFormState = null | { ok: true } | { ok: false; error: "validation"; fields: Partial<Record<ProductField, string>> } | Fail;

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

/** The form's fields, or the first message of each invalid one (D12). */
function parseProduct(form: FormData): { data: ProductData } | { fail: ProductFormState } {
  const parsed = productInput.safeParse(Object.fromEntries(form));
  if (parsed.success) return { data: parsed.data };
  const fields: Partial<Record<ProductField, string>> = {};
  for (const issue of parsed.error.issues) fields[issue.path[0] as ProductField] ??= issue.message;
  return { fail: { ok: false, error: "validation", fields } };
}

/** FR22 add (M3 plan D12, D13): on success the browser lands on the new product's edit page (D2). */
export async function createProduct(_prev: ProductFormState, form: FormData): Promise<ProductFormState> {
  await requireAdmin();
  const parsed = parseProduct(form);
  if ("fail" in parsed) return parsed.fail;
  let id;
  try {
    id = await createProductRow(db, parsed.data);
  } catch (error) {
    logFailure("createProduct", error);
    return { ok: false, error: "server" };
  }
  revalidateProducts();
  redirect(`/admin/produk/${id}`);
}

/** FR22 edit (M3 plan D12, D13): `id` is a hidden field of the form. */
export async function updateProduct(_prev: ProductFormState, form: FormData): Promise<ProductFormState> {
  await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { ok: false, error: "validation" };
  const parsed = parseProduct(form);
  if ("fail" in parsed) return parsed.fail;
  let found;
  try {
    found = await updateProductRow(db, id.data, parsed.data);
  } catch (error) {
    logFailure("updateProduct", error);
    return { ok: false, error: "server" };
  }
  if (!found) return { ok: false, error: "not_found" };
  revalidateProducts();
  return { ok: true };
}
