import { createHash, timingSafeEqual } from "node:crypto";
import { formatKind, MEDIA_LIMITS, type CloudinaryUpload, type MediaKind, type MediaRefusal } from "./media";

// Cloudinary signing, response verification, upload checks and destroy (System Design §4.5; M3 plan D4, D7, D15,
// D23). Server only: it reads CLOUDINARY_API_SECRET, so no client component may import it (R2, tests/media.test.ts).
// No SDK: node:crypto and fetch. Variables are read at call time. Errors carry the HTTP status and Cloudinary's message
// only, never the secret, the signature or the request body.

/** D7: production uploads go to kagumi/products; local, tests and previews to kagumi/dev/products (C11). */
export function uploadFolder(): string {
  return process.env.VERCEL_ENV === "production" ? "kagumi/products" : "kagumi/dev/products";
}

/**
 * The signature of a Cloudinary request (C3): the parameters sorted by name as "k=v&k=v", the API secret appended with
 * no separator, hashed to hex. Cloudinary accepts SHA-1 and SHA-256; requests use SHA-256 (System Design §4.5).
 */
export function signParams(params: Record<string, string | number>, secret: string, algorithm: "sha1" | "sha256" = "sha256"): string {
  const text = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash(algorithm).update(text + secret).digest("hex");
}

/**
 * True only when `signature` is Cloudinary's signature of exactly this `public_id` and `version` (C4). The hash is
 * picked by the signature's length (40 hex: SHA-1, the SDK default for responses; 64: SHA-256), and compared in
 * constant time. Never throws.
 */
export function verifyUploadResponse(r: { public_id: string; version: number; signature: string }, secret: string): boolean {
  try {
    if (typeof r.signature !== "string" || typeof r.public_id !== "string" || !Number.isInteger(r.version)) return false;
    const algorithm = r.signature.length === 40 ? "sha1" : "sha256";
    const expected = Buffer.from(signParams({ public_id: r.public_id, version: r.version }, secret, algorithm));
    const actual = Buffer.from(r.signature);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** The server's check of a verified upload response (D16 step 5): the folder, the format and the FR25 limits. */
export function checkUpload(upload: CloudinaryUpload, folder: string): { ok: true; kind: MediaKind } | { ok: false; reason: MediaRefusal } {
  if (!upload.public_id.startsWith(`${folder}/`)) return { ok: false, reason: "folder" };
  const kind = formatKind(upload.format);
  if (!kind || upload.resource_type !== kind.toLowerCase()) return { ok: false, reason: "format" };
  if (!(upload.bytes <= (kind === "IMAGE" ? MEDIA_LIMITS.imageBytes : MEDIA_LIMITS.videoBytes))) return { ok: false, reason: "size" };
  // Cloudinary always reports a video's duration; a missing one is refused rather than trusted.
  if (kind === "VIDEO" && !(typeof upload.duration === "number" && upload.duration <= MEDIA_LIMITS.videoSeconds)) {
    return { ok: false, reason: "duration" };
  }
  return { ok: true, kind };
}

/** The three variables (D15); the message names what is missing, never a value. */
export function credentials() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary variables are not set");
  return { cloudName, apiKey, apiSecret };
}

/**
 * Destroys one asset (C5): `ok`, or `not_found` when Cloudinary no longer has it (also done). Throws on anything else,
 * with the HTTP status and Cloudinary's message only.
 */
export async function destroyAsset(publicId: string, kind: MediaKind, fetchImpl: typeof fetch = fetch): Promise<"ok" | "not_found"> {
  const { cloudName, apiKey, apiSecret } = credentials();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signParams({ public_id: publicId, timestamp }, apiSecret);
  const body = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), api_key: apiKey, signature });
  let response: Response;
  try {
    response = await fetchImpl(`https://api.cloudinary.com/v1_1/${cloudName}/${kind === "VIDEO" ? "video" : "image"}/destroy`, { method: "POST", body });
  } catch {
    // The cause can quote the request; the name of the failure is enough.
    throw new Error("Cloudinary destroy: network error");
  }
  const json = (await response.json().catch(() => null)) as { result?: unknown; error?: { message?: unknown } } | null;
  if (response.ok && json?.result === "ok") return "ok";
  if (response.ok && json?.result === "not found") return "not_found";
  // Cloudinary's "Invalid Signature" message quotes the signature it got, so the request's values are blanked.
  let message = String(json?.error?.message ?? json?.result ?? "");
  for (const value of [signature, apiSecret, apiKey]) message = message.replaceAll(value, "…");
  message = message.slice(0, 200);
  throw new Error(`Cloudinary destroy: HTTP ${response.status}${message ? `: ${message}` : ""}`);
}
