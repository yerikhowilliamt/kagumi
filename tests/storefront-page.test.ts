// The storefront page rendered with its database and data cache replaced: no network (BSA-M1.2-01, -02).
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/(store)/page";
import buttonStyles from "@/components/Button.module.css";
import { toStoreProduct } from "@/lib/menu";

const { findMany, cached } = vi.hoisted(() => ({
  findMany: vi.fn(),
  cached: [] as { fn: () => Promise<unknown>; keys: string[]; options: unknown }[],
}));

vi.mock("@/lib/db", () => ({ db: { product: { findMany } } }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, keys: string[], options: unknown) => {
    cached.push({ fn, keys, options });
    return fn;
  },
}));

// Rows as Prisma returns them: a `date` column is a Date at UTC midnight.
const ROWS = [
  { name: "Bolu Gulung", orderDeadline: null },
  { name: "Hampers Natal", orderDeadline: new Date("2026-12-10T00:00:00.000Z") },
].map((row, i) => ({ id: `p${i}`, category: "Kue", description: "", price: 10000, type: "PRE_ORDER", media: [], ...row }));

const render = async () => renderToStaticMarkup(await Home());
const between = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to));
const marqueeOf = (html: string) => between(html, 'data-testid="marquee"', 'id="menu"');
const menuOf = (html: string) => between(html, 'id="menu"', 'id="cara-pesan"');
const cardNames = (html: string) => [...menuOf(html).matchAll(/<h3[^>]*>(?:<button[^>]*>)?([^<]+)/g)].map((m) => m[1]);

describe("storefront page", () => {
  beforeEach(() => findMany.mockReset().mockResolvedValue(ROWS));
  afterEach(() => vi.unstubAllEnvs());

  it("reads only active products, in sortOrder, through the cache tagged products", async () => {
    await render();
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ isActive: true });
    expect(args.orderBy[0]).toEqual({ sortOrder: "asc" });
    expect(cached).toHaveLength(1);
    expect(cached[0].options).toEqual({ tags: ["products"], revalidate: 3600 });
  });

  it("maps rows inside the cached function, so the cached value survives JSON", async () => {
    const products = (await cached[0].fn()) as { orderDeadline: unknown }[];
    expect(products.map((p) => p.orderDeadline)).toEqual([null, "2026-12-10"]);
    expect(JSON.parse(JSON.stringify(products))).toEqual(products);
  });

  it("keys the cache on the mapper's text, so a new mapped shape never reads an old entry (TR-M1.2-03)", () => {
    expect(cached[0].keys).toContain(toStoreProduct.toString());
  });

  it("TD-004: the key holds the tone list in its order, so a change to the tones changes the key", () => {
    const key = cached[0].keys.join("\n");
    expect(key).toMatch(/["']butter["'],\s*["']pink["'],\s*["']sky["'],\s*["']mint["']/);
    // The tones still follow the menu position.
    const tones = [0, 1, 2, 3, 4].map((i) => toStoreProduct({ ...ROWS[0], media: [] } as never, i).tone);
    expect(tones).toEqual(["butter", "pink", "sky", "mint", "butter"]);
  });

  it("renders the marquee with each product name twice", async () => {
    const html = await render();
    expect(html).toContain('data-testid="marquee"');
    // The menu and the promo card name it too.
    expect(marqueeOf(html).match(/Hampers Natal/g)).toHaveLength(2);
  });

  it("M3.5, D17: a card shows its product's first image through Cloudinary with an empty alt; only a video keeps the placeholder", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "demo-cloud");
    const medium = (publicId: string, kind: string, isMain: boolean, sortOrder: number) => ({
      publicId: `kagumi/dev/products/${publicId}`,
      kind,
      version: 5,
      format: kind === "IMAGE" ? "jpg" : "mp4",
      width: 10,
      height: 10,
      durationSec: kind === "IMAGE" ? null : 2,
      isMain,
      sortOrder,
    });
    findMany.mockResolvedValue([
      { ...ROWS[0], media: [medium("klip", "VIDEO", false, 0), medium("foto", "IMAGE", true, 1)] },
      { ...ROWS[1], media: [medium("hanya-video", "VIDEO", false, 0)] },
    ]);
    const cards = menuOf(await render()).split("<li").slice(1);
    const card = (name: string) => cards.find((c) => c.includes(`>${name}<`)) ?? "";
    const photo = card("Bolu Gulung").match(/<img[^>]*res\.cloudinary\.com[^>]*>/)?.[0] ?? "";
    expect(photo).toMatch(/src="https:\/\/res\.cloudinary\.com\/demo-cloud\/image\/upload\/f_auto,q_auto,c_fill,w_\d+\/v5\/kagumi\/dev\/products\/foto"/);
    expect(photo).toContain('alt=""');
    expect(card("Hampers Natal")).toContain("Hampers Natal");
    expect(card("Hampers Natal")).not.toContain("res.cloudinary.com");
    expect(card("Hampers Natal")).toContain("%2Fimages%2Flogo.jpg"); // the placeholder's mark
  });

  it("hides the marquee with no active products and still renders the page", async () => {
    findMany.mockResolvedValue([]);
    const html = await render();
    expect(html).not.toContain('data-testid="marquee"');
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('id="menu"');
  });
});

// The date-dependent parts as the server renders them (D22): the browser takes over after hydration (e2e/menu.spec.ts).
describe("storefront page: menu, notice bar and promo card at the render date", () => {
  const row = (name: string, type: string, orderDeadline: Date | null, i: number) => ({
    id: `p${i}`,
    name,
    category: "Kue",
    description: "",
    price: null,
    type,
    orderDeadline,
    media: [],
  });
  // The dated product comes first in sortOrder.
  const DATED_FIRST = [
    row("Hampers Natal", "PRE_ORDER", new Date("2026-12-10T00:00:00.000Z"), 0),
    row("Soft Cookies", "READY_STOCK", null, 1),
  ];
  const renderAt = async (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
    return render();
  };

  afterEach(() => vi.useRealTimers());

  it("on the deadline day in WIB (23:59): open, in sortOrder, with the phrase and the promo card", async () => {
    findMany.mockResolvedValue(DATED_FIRST);
    const html = await renderAt("2026-12-10T16:59:00.000Z");
    expect(cardNames(html)).toEqual(["Hampers Natal", "Soft Cookies"]);
    expect(html).not.toContain("Order sudah ditutup");
    expect(html).toContain("<strong>Open pre-order</strong>");
    expect(html).toContain("Pre-order dibuka");
  });

  it("one minute later (00:00 WIB, still the deadline day in UTC): closed, sorted last, no phrase, no promo card", async () => {
    findMany.mockResolvedValue(DATED_FIRST);
    const html = await renderAt("2026-12-10T17:00:00.000Z");
    expect(cardNames(html)).toEqual(["Soft Cookies", "Hampers Natal"]);
    expect(menuOf(html).match(/Order sudah ditutup/g)).toHaveLength(1);
    expect(html).not.toContain("Open pre-order");
    expect(html).not.toContain("Pre-order dibuka");
    expect(html).toContain("Pengantaran tersedia untuk area Solo");
  });

  it("only ready stock: no phrase and no promo card, the chips stay", async () => {
    findMany.mockResolvedValue([row("Soft Cookies", "READY_STOCK", null, 0)]);
    const html = await renderAt("2026-11-20T03:00:00.000Z");
    expect(html).not.toContain("Open pre-order");
    expect(html).not.toContain("Pre-order dibuka");
    expect(menuOf(html).match(/aria-pressed=/g)).toHaveLength(3);
  });

  it("no products (D8): the heading, the empty text and a WhatsApp link; no chips, phrase or promo card", async () => {
    findMany.mockResolvedValue([]);
    const html = await renderAt("2026-11-20T03:00:00.000Z");
    const menu = menuOf(html);
    expect(menu).toContain("Pilihan favorit kami");
    expect(menu).toContain("Menu sedang kami siapkan. Untuk pesan sekarang, chat kami di WhatsApp.");
    const link = menu.match(/<a[^>]*href="https:\/\/wa\.me\/6285159545168"[^>]*>Chat WhatsApp<\/a>/)?.[0] ?? "";
    // D8: a Line button (BSA-M1.3-01).
    expect(link.match(/class="([^"]*)"/)?.[1].split(" ")).toContain(buttonStyles.line);
    expect(menu).not.toContain("aria-pressed");
    expect(cardNames(html)).toEqual([]);
    expect(html).not.toContain("Open pre-order");
    expect(html).not.toContain("Pre-order dibuka");
  });
});
