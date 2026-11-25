// src/lib/media.ts (task M3.3 K3, K7; M3.4 K2): the browser's file check (FR25, System Design §9 upload limits), the
// picker filter and the refusal messages (M3 plan D16, D18), the delivery URLs (System Design §4.5, D17) and R2: the API
// secret's module never reaches client code.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCEPT, checkFile, cloudinaryLoader, formatDuration, IMAGE_FORMATS, imageUrl, posterUrl, refusalMessage, VIDEO_FORMATS, videoUrl } from "@/lib/media";

const MiB = 1024 * 1024;
afterEach(() => vi.unstubAllEnvs());

describe("checkFile (FR25)", () => {
  it("accepts the allowed formats by extension and MIME family, also a .jpeg and a HEIC with no MIME type", () => {
    for (const [name, type] of [
      ["a.jpg", "image/jpeg"],
      ["a.JPEG", "image/jpeg"],
      ["a.png", "image/png"],
      ["a.webp", "image/webp"],
      ["IMG_1.HEIC", "image/heic"],
      ["IMG_1.heic", ""],
    ]) {
      expect(checkFile({ name, type, size: 1 }, null), name).toEqual({ ok: true, kind: "IMAGE" });
    }
    for (const [name, type] of [
      ["a.mp4", "video/mp4"],
      ["IMG_2.MOV", "video/quicktime"],
    ]) {
      expect(checkFile({ name, type, size: 1 }, 5), name).toEqual({ ok: true, kind: "VIDEO" });
    }
  });

  it("refuses another format, a missing extension, or a MIME type of the other family", () => {
    for (const [name, type] of [
      ["a.gif", "image/gif"],
      ["a.avi", "video/x-msvideo"],
      ["a.pdf", "application/pdf"],
      ["jpg", "image/jpeg"],
      ["a.jpg", "video/mp4"],
      ["a.mp4", "image/png"],
      ["a.jpg", "application/octet-stream"],
    ]) {
      expect(checkFile({ name, type, size: 1 }, null), `${name} ${type}`).toEqual({ ok: false, reason: "format" });
    }
  });

  it("accepts each limit exactly and refuses one byte or 0.01 s more; an unreadable duration goes on to the server", () => {
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: 10 * MiB }, null)).toEqual({ ok: true, kind: "IMAGE" });
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: 10 * MiB + 1 }, null)).toEqual({ ok: false, reason: "size" });
    expect(checkFile({ name: "a.mp4", type: "video/mp4", size: 50 * MiB }, 30)).toEqual({ ok: true, kind: "VIDEO" });
    expect(checkFile({ name: "a.mp4", type: "video/mp4", size: 50 * MiB + 1 }, 1)).toEqual({ ok: false, reason: "size" });
    expect(checkFile({ name: "a.mp4", type: "video/mp4", size: 1 }, 30.01)).toEqual({ ok: false, reason: "duration" });
    expect(checkFile({ name: "a.mp4", type: "video/mp4", size: 1 }, null)).toEqual({ ok: true, kind: "VIDEO" });
  });
});

describe("picker filter and refusal messages (M3.4, D16, D18)", () => {
  it("the picker offers every allowed format, and .jpeg, and nothing else", () => {
    const offered = ACCEPT.split(",");
    expect(offered.sort()).toEqual([...IMAGE_FORMATS, ...VIDEO_FORMATS, "jpeg"].map((f) => `.${f}`).sort());
  });

  it("names each refusal with its D18 message, the size by kind", () => {
    expect(refusalMessage("size", "IMAGE")).toBe("Foto lebih dari 10 MB.");
    expect(refusalMessage("size", "VIDEO")).toBe("Video lebih dari 50 MB.");
    expect(refusalMessage("duration", "VIDEO")).toBe("Video lebih dari 30 detik.");
    expect(refusalMessage("format", null)).toBe("Format file tidak didukung.");
    expect(refusalMessage("folder", "IMAGE")).toBe("Upload gagal. Coba lagi.");
  });

  it("writes a duration as m:ss, rounded to the second", () => {
    expect(formatDuration(2)).toBe("0:02");
    expect(formatDuration(29.6)).toBe("0:30");
    expect(formatDuration(75.4)).toBe("1:15");
  });
});

describe("delivery URLs (D17)", () => {
  const m = { publicId: "kagumi/dev/products/abc", version: 1732400000 };

  it("builds the transformation URLs of System Design §4.5", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "demo-cloud");
    const base = "https://res.cloudinary.com/demo-cloud";
    expect(imageUrl(m, 400)).toBe(`${base}/image/upload/f_auto,q_auto,c_fill,w_400/v1732400000/kagumi/dev/products/abc`);
    expect(posterUrl(m, 640)).toBe(`${base}/video/upload/so_0,f_auto,q_auto,c_fill,w_640/v1732400000/kagumi/dev/products/abc.jpg`);
    expect(videoUrl(m)).toBe(`${base}/video/upload/f_auto,q_auto,vc_auto/v1732400000/kagumi/dev/products/abc`);
    expect(cloudinaryLoader({ src: "v1732400000/kagumi/dev/products/abc", width: 828 })).toBe(
      `${base}/image/upload/f_auto,q_auto,c_fill,w_828/v1732400000/kagumi/dev/products/abc`,
    );
  });

  it("the loader puts each width next/image asks for into the URL, and keeps src as given (M3.5)", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "demo-cloud");
    const src = "v7/kagumi/products/a-b";
    for (const width of [16, 48, 96, 384, 640, 1080, 3840]) {
      expect(cloudinaryLoader({ src, width }), String(width)).toBe(`https://res.cloudinary.com/demo-cloud/image/upload/f_auto,q_auto,c_fill,w_${width}/${src}`);
    }
  });
});

describe("R2: the secret's module stays on the server", () => {
  const src = join(import.meta.dirname, "..", "src");
  const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) => /\.(ts|tsx)$/.test(f));

  it("src/lib/media.ts imports nothing", () => {
    const text = readFileSync(join(src, "lib", "media.ts"), "utf8");
    expect(text).not.toMatch(/^\s*import\b|\bimport\s*\(|\brequire\s*\(|^\s*export\s.*\sfrom\s/m);
  });

  it('no "use client" file imports lib/cloudinary', () => {
    const client = files.filter((f) => /^\s*(\/\/.*\n\s*)*["']use client["']/.test(readFileSync(join(src, f), "utf8")));
    expect(client.length).toBeGreaterThan(5); // the scan finds the client components (Dialog, ProductForm, …)
    const leaks = client.filter((f) => /from\s+["'](@\/lib\/cloudinary|[./]*\/?(lib\/)?cloudinary)["']|import\(\s*["'][^"']*cloudinary["']/.test(readFileSync(join(src, f), "utf8")));
    expect(leaks).toEqual([]);
  });
});
