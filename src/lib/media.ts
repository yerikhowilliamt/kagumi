// Media limits, formats and delivery URLs (FR24–FR26, System Design §4.5, §9; M3 plan D15, D17, D23). Client-safe and
// imports nothing, so a client component can use it without pulling in the API secret's module (R2,
// tests/media.test.ts). Signing, verification and destroy live in the server-only ./cloudinary.

export const MEDIA_LIMITS = { imageBytes: 10 * 1024 * 1024, videoBytes: 50 * 1024 * 1024, videoSeconds: 30 } as const;
// As Cloudinary reports `format` (C7); a ".jpeg" file name counts as jpg.
export const IMAGE_FORMATS = ["jpg", "png", "webp", "heic"] as const;
export const VIDEO_FORMATS = ["mp4", "mov"] as const;

export type MediaKind = "IMAGE" | "VIDEO";
export type MediaRefusal = "folder" | "format" | "size" | "duration";

/** The fields of Cloudinary's upload response that the browser forwards to the server (D16 step 4). */
export type CloudinaryUpload = {
  public_id: string;
  version: number;
  signature: string;
  resource_type: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  duration?: number | null;
};

/** IMAGE or VIDEO for an allowed format, else null. */
export const formatKind = (format: string): MediaKind | null =>
  (IMAGE_FORMATS as readonly string[]).includes(format) ? "IMAGE" : (VIDEO_FORMATS as readonly string[]).includes(format) ? "VIDEO" : null;

/**
 * The browser's check before an upload (D16 step 1): the file name's extension and, when the browser reports one, the
 * MIME type's family; the size; for a video the duration, when it could be read (null: the server decides, C8).
 */
export function checkFile(
  file: { type: string; name: string; size: number },
  durationSec: number | null,
): { ok: true; kind: MediaKind } | { ok: false; reason: Exclude<MediaRefusal, "folder"> } {
  const dot = file.name.lastIndexOf(".");
  const extension = dot < 0 ? "" : file.name.slice(dot + 1).toLowerCase();
  const kind = formatKind(extension === "jpeg" ? "jpg" : extension);
  // Some desktop browsers report no MIME type for HEIC: then the extension decides alone.
  if (!kind || (file.type !== "" && !file.type.startsWith(kind === "IMAGE" ? "image/" : "video/"))) return { ok: false, reason: "format" };
  if (file.size > (kind === "IMAGE" ? MEDIA_LIMITS.imageBytes : MEDIA_LIMITS.videoBytes)) return { ok: false, reason: "size" };
  if (kind === "VIDEO" && durationSec !== null && durationSec > MEDIA_LIMITS.videoSeconds) return { ok: false, reason: "duration" };
  return { ok: true, kind };
}

/** The file picker's filter (D16 step 1); checkFile stays the rule, since a drop or a picker can ignore it. */
export const ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.mp4,.mov";

/** The message of a refused or failed file (M3 plan D18). A folder refusal is not the owner's doing. */
export function refusalMessage(reason: MediaRefusal, kind: MediaKind | null): string {
  if (reason === "format") return "Format file tidak didukung.";
  if (reason === "duration") return "Video lebih dari 30 detik.";
  if (reason === "size") return kind === "VIDEO" ? "Video lebih dari 50 MB." : "Foto lebih dari 10 MB.";
  return "Upload gagal. Coba lagi.";
}

/** A video's duration chip, "m:ss". */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Media = { publicId: string; version: number };
// Read at call time; NEXT_PUBLIC_ is inlined into client code at build time (D15).
const base = () => `https://res.cloudinary.com/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}`;

/** next/image loader (D17): `src` is "v<version>/<public_id>". */
export function cloudinaryLoader({ src, width }: { src: string; width: number }): string {
  return `${base()}/image/upload/f_auto,q_auto,c_fill,w_${width}/${src}`;
}

export function imageUrl(m: Media, width: number): string {
  return cloudinaryLoader({ src: `v${m.version}/${m.publicId}`, width });
}

// M3.6 (D17 revised): a video's H.264 MP4 and its 960 px poster are derived at upload (`VIDEO_EAGER`, signed by
// getUploadSignature). Cloudinary serves an eager asset only when the delivery URL matches it exactly, extension
// included, and f_auto/vc_auto would pick another format per browser; so both URLs are fixed and built from the same
// strings as the eager list.
const VIDEO_TRANSFORM = "f_mp4,vc_h264,q_auto,c_limit,h_1920,w_1920";
const posterTransform = (width: number) => `so_0,q_auto,c_fill,w_${width}`;
/** The detail's main slot poster; the only poster width derived at upload (thumbnails derive on first request). */
export const EAGER_POSTER_WIDTH = 960;
/** Cloudinary's `eager` upload parameter for a video: transformations joined by "|", each with its extension. */
export const VIDEO_EAGER = `${VIDEO_TRANSFORM}/mp4|${posterTransform(EAGER_POSTER_WIDTH)}/jpg`;

export function posterUrl(m: Media, width: number): string {
  return `${base()}/video/upload/${posterTransform(width)}/v${m.version}/${m.publicId}.jpg`;
}

export function videoUrl(m: Media): string {
  return `${base()}/video/upload/${VIDEO_TRANSFORM}/v${m.version}/${m.publicId}.mp4`;
}
