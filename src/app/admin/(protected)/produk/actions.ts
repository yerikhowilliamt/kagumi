"use server";
// Every export of this file is an endpoint (M3 plan D13, D23), each behind requireAdmin().
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { checkUpload, credentials, destroyAsset, signParams, uploadFolder, verifyUploadResponse } from "@/lib/cloudinary";
import { db } from "@/lib/db";
import { IMAGE_FORMATS, VIDEO_FORMATS, type MediaRefusal } from "@/lib/media";
import {
  addMediaRow,
  createProductRow,
  deleteMediaRow,
  deleteProductRow,
  moveRow,
  processDeletions,
  setActive,
  setMainRow,
  updateProductRow,
  type AdminMedia,
  type QueuedAsset,
} from "@/lib/products";
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

/**
 * D4 step 2 after a commit: destroys the queued assets. A failed destroy stays in pending_deletions for the cron and is
 * logged as a count; a database error is logged by name and code. Awaited, not after(): the function may stop once it
 * has answered, and the queue rows already make this safe.
 */
async function destroyQueued(action: string, assets: QueuedAsset[]) {
  try {
    const failed = await processDeletions(db, assets, (publicId, kind) => destroyAsset(publicId, kind));
    if (failed > 0) console.error(`[${action}] destroy failed, left in pending_deletions:`, failed);
  } catch (error) {
    logFailure(action, error);
  }
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

/**
 * FR27 delete (M3 plan D4, D13): the product and its queue rows in one transaction, then each asset destroyed. A failed
 * destroy stays in pending_deletions for the cron and doesn't fail the delete. Success → the products list.
 */
export async function deleteProduct(productId: string): Promise<Fail> {
  await requireAdmin();
  const id = z.uuid().safeParse(productId);
  if (!id.success) return { ok: false, error: "validation" };
  let assets;
  try {
    assets = await db.$transaction((tx) => deleteProductRow(tx, id.data), {
      maxWait: 10_000, // opening a Neon connection can take longer than Prisma's 2 s default (ERR-003)
    });
  } catch (error) {
    logFailure("deleteProduct", error);
    return { ok: false, error: "server" };
  }
  if (!assets) return { ok: false, error: "not_found" };
  revalidateProducts();
  await destroyQueued("deleteProduct", assets);
  redirect("/admin/produk");
}

// FR23–FR25 media (M3 plan D2, D10, D11, D13, D16): one action per medium, saved right after its upload.

const TX = { maxWait: 10_000 }; // opening a Neon connection can take longer than Prisma's 2 s default (ERR-003)
const ALLOWED_FORMATS = [...IMAGE_FORMATS, ...VIDEO_FORMATS].join(",");

/**
 * D16 step 2: the fields of one signed upload into this deployment's folder (D7). Nothing is written. The API key goes
 * to the browser because Cloudinary needs it in the request; the secret never leaves the server.
 */
export async function getUploadSignature(): Promise<
  { ok: true; cloudName: string; apiKey: string; timestamp: number; folder: string; allowedFormats: string; signature: string } | { ok: false; error: "server" }
> {
  await requireAdmin();
  let keys;
  try {
    keys = credentials();
  } catch (error) {
    logFailure("getUploadSignature", error);
    return { ok: false, error: "server" };
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = uploadFolder();
  const signature = signParams({ allowed_formats: ALLOWED_FORMATS, folder, timestamp }, keys.apiSecret);
  return { ok: true, cloudName: keys.cloudName, apiKey: keys.apiKey, timestamp, folder, allowedFormats: ALLOWED_FORMATS, signature };
}

const int4 = z.number().int().max(2_147_483_647);
// The fields of Cloudinary's upload response that the browser forwards (D16 step 4); anything else is dropped.
const uploadInput = z.object({
  productId: z.uuid(),
  upload: z.object({
    public_id: z.string().min(1).max(255),
    version: int4.positive(),
    signature: z.string().max(64),
    resource_type: z.string().max(10),
    format: z.string().max(10),
    bytes: int4.positive(),
    width: int4.nonnegative(),
    height: int4.nonnegative(),
    duration: z.number().nonnegative().nullish(),
  }),
});

/** A verified asset that won't be saved goes through D4: queued, then destroyed (also when the queue write failed). */
async function discardUpload(asset: QueuedAsset) {
  try {
    await db.pendingDeletion.createMany({ data: [asset], skipDuplicates: true });
  } catch (error) {
    logFailure("addProductMedia", error);
  }
  await destroyQueued("addProductMedia", [asset]);
}

type MediaFail = Fail | { ok: false; error: "limit"; reason: MediaRefusal };

/**
 * D16 step 5: the response's signature first (false: `validation`, and nothing is destroyed, since the asset isn't
 * proven ours), then the folder and the FR25 limits (refused: the asset through D4, `limit`), then the D11 row under
 * the product lock. A public_id already saved is refused right after the verification and never destroyed; every
 * other failure after the verification sends the asset through D4.
 */
export async function addProductMedia(productId: string, upload: unknown): Promise<{ ok: true; media: AdminMedia } | MediaFail> {
  await requireAdmin();
  const parsed = uploadInput.safeParse({ productId, upload });
  if (!parsed.success) return { ok: false, error: "validation" };
  const u = parsed.data.upload;
  let secret;
  try {
    secret = credentials().apiSecret;
  } catch (error) {
    logFailure("addProductMedia", error);
    return { ok: false, error: "server" };
  }
  if (!verifyUploadResponse(u, secret)) return { ok: false, error: "validation" };
  // A public_id already saved (a replayed response) is in use: refused before any check that would destroy it
  // (BSA-M3.4-01). On a database error nothing is destroyed either, since the row may exist.
  try {
    if ((await db.productMedia.count({ where: { publicId: u.public_id } })) > 0) return { ok: false, error: "validation" };
  } catch (error) {
    logFailure("addProductMedia", error);
    return { ok: false, error: "server" };
  }
  const asset: QueuedAsset = { publicId: u.public_id, kind: u.resource_type === "video" ? "VIDEO" : "IMAGE" };
  const check = checkUpload(u, uploadFolder());
  if (!check.ok) {
    await discardUpload(asset);
    return { ok: false, error: "limit", reason: check.reason };
  }
  const media = {
    publicId: u.public_id,
    kind: check.kind,
    version: u.version,
    format: u.format,
    width: u.width,
    height: u.height,
    bytes: u.bytes,
    durationSec: check.kind === "VIDEO" ? (u.duration ?? null) : null,
  };
  let result;
  try {
    result = await db.$transaction((tx) => addMediaRow(tx, parsed.data.productId, media), TX);
  } catch (error) {
    logFailure("addProductMedia", error);
    await discardUpload(asset);
    return { ok: false, error: "server" };
  }
  if (result === "duplicate") return { ok: false, error: "validation" };
  if (result === "not_found") {
    await discardUpload(asset);
    return { ok: false, error: "not_found" };
  }
  revalidateProducts();
  return { ok: true, media: result };
}

const mediaInput = z.object({ productId: z.uuid(), mediaId: z.uuid() });

/** D11 "Jadikan utama": `validation` for a video. */
export async function setMainMedia(productId: string, mediaId: string): Promise<{ ok: true } | Fail> {
  await requireAdmin();
  const parsed = mediaInput.safeParse({ productId, mediaId });
  if (!parsed.success) return { ok: false, error: "validation" };
  let result;
  try {
    result = await db.$transaction((tx) => setMainRow(tx, parsed.data.productId, parsed.data.mediaId), TX);
  } catch (error) {
    logFailure("setMainMedia", error);
    return { ok: false, error: "server" };
  }
  if (result === "not_found") return { ok: false, error: "not_found" };
  if (result === "video") return { ok: false, error: "validation" };
  if (result === "ok") revalidateProducts();
  return { ok: true };
}

/** D3, D11 "Geser ke kiri" / "Geser ke kanan": `validation` for the main medium or a move past an end. */
export async function moveMedia(productId: string, mediaId: string, direction: "left" | "right"): Promise<{ ok: true } | Fail> {
  await requireAdmin();
  const parsed = mediaInput.extend({ direction: z.enum(["left", "right"]) }).safeParse({ productId, mediaId, direction });
  if (!parsed.success) return { ok: false, error: "validation" };
  let result;
  try {
    result = await db.$transaction((tx) => moveRow(tx, parsed.data.productId, parsed.data.mediaId, parsed.data.direction), TX);
  } catch (error) {
    logFailure("moveMedia", error);
    return { ok: false, error: "server" };
  }
  if (result === "not_found") return { ok: false, error: "not_found" };
  if (result === "invalid") return { ok: false, error: "validation" };
  revalidateProducts();
  return { ok: true };
}

/** D4, D11 remove: the row and its queue row in one transaction, then the destroy; a failed destroy stays queued. */
export async function deleteMedia(productId: string, mediaId: string): Promise<{ ok: true } | Fail> {
  await requireAdmin();
  const parsed = mediaInput.safeParse({ productId, mediaId });
  if (!parsed.success) return { ok: false, error: "validation" };
  let asset;
  try {
    asset = await db.$transaction((tx) => deleteMediaRow(tx, parsed.data.productId, parsed.data.mediaId), TX);
  } catch (error) {
    logFailure("deleteMedia", error);
    return { ok: false, error: "server" };
  }
  if (!asset) return { ok: false, error: "not_found" };
  revalidateProducts();
  await destroyQueued("deleteMedia", [asset]);
  return { ok: true };
}
