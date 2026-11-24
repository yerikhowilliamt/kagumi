// src/lib/cloudinary.ts (task M3.3 K2–K4), written from Cloudinary's documentation (authentication_signatures,
// destroy; fetched 2026-11-24) and the M3 plan D7, D15, FR25. fetch is always stubbed: no Cloudinary call here.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { timingSafeEqual } = vi.hoisted(() => ({ timingSafeEqual: vi.fn() }));
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  timingSafeEqual.mockImplementation(real.timingSafeEqual);
  return { ...real, timingSafeEqual };
});

const { checkUpload, destroyAsset, signParams, uploadFolder, verifyUploadResponse } = await import("@/lib/cloudinary");
const { MEDIA_LIMITS } = await import("@/lib/media");

const hash = (algorithm: string, text: string) => createHash(algorithm).update(text).digest("hex");

afterEach(() => {
  vi.unstubAllEnvs();
  timingSafeEqual.mockClear();
});

describe("signParams (C3)", () => {
  // Cloudinary's documented examples, secret "abcd", SHA-1 (the only digests the page prints).
  it("reproduces the documented signatures exactly", () => {
    expect(signParams({ timestamp: 1315060510 }, "abcd", "sha1")).toBe("a21ad0f63beb4de2e5575204b79ab90bffb02c10");
    expect(
      signParams({ timestamp: 1315060510, public_id: "sample_image", eager: "w_400,h_300,c_pad|w_260,h_200,c_crop" }, "abcd", "sha1"),
    ).toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
  });

  it("uses SHA-256 by default over the same sorted string (System Design §4.5)", () => {
    const signed = signParams({ timestamp: 1315060510, public_id: "sample_image", eager: "w_400,h_300,c_pad|w_260,h_200,c_crop" }, "abcd");
    expect(signed).toBe(hash("sha256", "eager=w_400,h_300,c_pad|w_260,h_200,c_crop&public_id=sample_image&timestamp=1315060510abcd"));
    expect(signed).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("uploadFolder (D7, C11)", () => {
  it("is kagumi/products on the production deployment only", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(uploadFolder()).toBe("kagumi/products");
    for (const env of ["preview", "development", ""]) {
      vi.stubEnv("VERCEL_ENV", env);
      expect(uploadFolder(), env).toBe("kagumi/dev/products");
    }
  });
});

describe("verifyUploadResponse (C4, K3)", () => {
  const secret = "test-secret";
  const publicId = "kagumi/dev/products/abc123";
  const sha1 = hash("sha1", `public_id=${publicId}&version=1732400000${secret}`);
  const sha256 = hash("sha256", `public_id=${publicId}&version=1732400000${secret}`);

  it("is true for the untouched pair, SHA-1 or SHA-256, compared with timingSafeEqual on equal-length buffers", () => {
    for (const signature of [sha1, sha256]) {
      timingSafeEqual.mockClear();
      expect(verifyUploadResponse({ public_id: publicId, version: 1732400000, signature }, secret)).toBe(true);
      expect(timingSafeEqual).toHaveBeenCalledTimes(1);
      const [a, b] = timingSafeEqual.mock.calls[0] as [Buffer, Buffer];
      expect(Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.length === b.length).toBe(true);
    }
  });

  it("is false for a changed version, public_id, secret or signature, and for a wrong length", () => {
    expect(verifyUploadResponse({ public_id: publicId, version: 1732400001, signature: sha1 }, secret)).toBe(false);
    expect(verifyUploadResponse({ public_id: `${publicId}x`, version: 1732400000, signature: sha1 }, secret)).toBe(false);
    expect(verifyUploadResponse({ public_id: publicId, version: 1732400000, signature: sha1 }, "other")).toBe(false);
    const flipped = sha1.slice(0, -1) + (sha1.endsWith("0") ? "1" : "0");
    expect(verifyUploadResponse({ public_id: publicId, version: 1732400000, signature: flipped }, secret)).toBe(false);
    for (const signature of [sha1.slice(0, 39), `${sha256}0`, "", sha1.toUpperCase()]) {
      expect(verifyUploadResponse({ public_id: publicId, version: 1732400000, signature }, secret), signature).toBe(false);
    }
  });

  it("never throws on garbage", () => {
    for (const r of [{}, { public_id: publicId, version: "1", signature: sha1 }, { public_id: null, version: 1, signature: sha1 }, { public_id: publicId, version: 1, signature: 42 }]) {
      expect(() => verifyUploadResponse(r as never, secret)).not.toThrow();
      expect(verifyUploadResponse(r as never, secret)).toBe(false);
    }
  });
});

describe("checkUpload (FR25, K3)", () => {
  const folder = "kagumi/dev/products";
  const image = { public_id: `${folder}/a`, version: 1, signature: "", resource_type: "image", format: "jpg", bytes: 1000, width: 10, height: 10 };
  const video = { ...image, resource_type: "video", format: "mp4", duration: 12 };

  it("accepts every allowed format and each limit exactly", () => {
    for (const format of ["jpg", "png", "webp", "heic"]) expect(checkUpload({ ...image, format }, folder), format).toEqual({ ok: true, kind: "IMAGE" });
    for (const format of ["mp4", "mov"]) expect(checkUpload({ ...video, format }, folder), format).toEqual({ ok: true, kind: "VIDEO" });
    expect(checkUpload({ ...image, bytes: 10 * 1024 * 1024 }, folder)).toEqual({ ok: true, kind: "IMAGE" });
    expect(checkUpload({ ...video, bytes: 50 * 1024 * 1024, duration: 30 }, folder)).toEqual({ ok: true, kind: "VIDEO" });
    expect(MEDIA_LIMITS).toEqual({ imageBytes: 10 * 1024 * 1024, videoBytes: 50 * 1024 * 1024, videoSeconds: 30 });
  });

  it("refuses another folder", () => {
    for (const public_id of ["kagumi/products/a", "kagumi/dev/productsX/a", "a", `x/${folder}/a`]) {
      expect(checkUpload({ ...image, public_id }, folder), public_id).toEqual({ ok: false, reason: "folder" });
    }
  });

  it("refuses a format outside the lists, or one that doesn't match the resource type", () => {
    for (const format of ["gif", "jpeg", "pdf", "avi", ""]) expect(checkUpload({ ...image, format }, folder), format).toEqual({ ok: false, reason: "format" });
    expect(checkUpload({ ...image, resource_type: "video" }, folder)).toEqual({ ok: false, reason: "format" });
    expect(checkUpload({ ...video, resource_type: "raw" }, folder)).toEqual({ ok: false, reason: "format" });
  });

  it("refuses an image of 10 MiB + 1 byte, a video of 50 MiB + 1 byte, one of 30.01 s and one without a duration", () => {
    expect(checkUpload({ ...image, bytes: 10 * 1024 * 1024 + 1 }, folder)).toEqual({ ok: false, reason: "size" });
    expect(checkUpload({ ...video, bytes: 50 * 1024 * 1024 + 1 }, folder)).toEqual({ ok: false, reason: "size" });
    expect(checkUpload({ ...image, bytes: Number.NaN }, folder)).toEqual({ ok: false, reason: "size" });
    expect(checkUpload({ ...video, duration: 30.01 }, folder)).toEqual({ ok: false, reason: "duration" });
    expect(checkUpload({ ...video, duration: undefined }, folder)).toEqual({ ok: false, reason: "duration" });
  });
});

describe("destroyAsset (C5, K4)", () => {
  const SECRET = "fake-secret-value-0123456789";
  const KEY = "987654321012345";
  const env = () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "demo-cloud");
    vi.stubEnv("CLOUDINARY_API_KEY", KEY);
    vi.stubEnv("CLOUDINARY_API_SECRET", SECRET);
  };
  const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("posts a signed public_id and timestamp to the kind's destroy endpoint and resolves ok", async () => {
    env();
    const fetchImpl = answer(200, { result: "ok" });
    expect(await destroyAsset("kagumi/dev/products/a b", "IMAGE", fetchImpl as never)).toBe("ok");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudinary.com/v1_1/demo-cloud/image/destroy");
    expect(init.method).toBe("POST");
    const body = init.body as URLSearchParams;
    expect([...body.keys()].toSorted()).toEqual(["api_key", "public_id", "signature", "timestamp"]);
    expect(body.get("public_id")).toBe("kagumi/dev/products/a b");
    expect(body.get("api_key")).toBe(KEY);
    expect(Math.abs(Number(body.get("timestamp")) - Date.now() / 1000)).toBeLessThan(5);
    expect(body.get("signature")).toBe(hash("sha256", `public_id=kagumi/dev/products/a b&timestamp=${body.get("timestamp")}${SECRET}`));

    const video = answer(200, { result: "ok" });
    await destroyAsset("kagumi/dev/products/v", "VIDEO", video as never);
    expect((video.mock.calls[0] as unknown as [string])[0]).toBe("https://api.cloudinary.com/v1_1/demo-cloud/video/destroy");
  });

  it("resolves not_found when Cloudinary no longer has the asset", async () => {
    env();
    expect(await destroyAsset("kagumi/dev/products/a", "IMAGE", answer(200, { result: "not found" }) as never)).toBe("not_found");
  });

  /** The thrown message, checked for the status and for every secret of the request. */
  async function failure(fetchImpl: unknown) {
    env();
    const error = await destroyAsset("kagumi/dev/products/a", "IMAGE", fetchImpl as never).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    const signature = signParams({ public_id: "kagumi/dev/products/a", timestamp: Math.floor(Date.now() / 1000) }, SECRET);
    for (const secret of [SECRET, KEY, signature, signature.slice(0, 16)]) expect(error!.message).not.toContain(secret);
    return error!.message;
  }

  it("throws on HTTP 500 with the status and Cloudinary's message, without the secret, the signature or the key", async () => {
    expect(await failure(answer(500, { error: { message: "General Error" } }))).toBe("Cloudinary destroy: HTTP 500: General Error");
  });

  it("blanks the signature that Cloudinary's 'Invalid Signature' message quotes back", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = (init.body as URLSearchParams).get("signature");
      const key = (init.body as URLSearchParams).get("api_key");
      return new Response(JSON.stringify({ error: { message: `Invalid Signature ${sent}. String to sign - 'public_id=x&timestamp=1' key ${key} ${SECRET}` } }), { status: 401 });
    });
    expect(await failure(fetchImpl)).toMatch(/^Cloudinary destroy: HTTP 401: Invalid Signature …/);
  });

  it("throws on a network error without the request in the message", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      throw new TypeError(`fetch failed ${String(init.body)}`, { cause: init.body });
    });
    expect(await failure(fetchImpl)).toBe("Cloudinary destroy: network error");
  });

  it("throws on an answer that is neither ok nor not found, or not JSON", async () => {
    expect(await failure(answer(200, { result: "error" }))).toBe("Cloudinary destroy: HTTP 200: error");
    expect(await failure(vi.fn(async () => new Response("<html>", { status: 502 })))).toBe("Cloudinary destroy: HTTP 502");
  });

  it("throws before any request when a variable is missing, naming no value", async () => {
    env();
    vi.stubEnv("CLOUDINARY_API_SECRET", "");
    const fetchImpl = answer(200, { result: "ok" });
    await expect(destroyAsset("kagumi/dev/products/a", "IMAGE", fetchImpl as never)).rejects.toThrow(/^Cloudinary variables are not set$/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
