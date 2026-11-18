// The menu's client components rendered without a browser, for the states the development seed cannot reach
// (BSA-M1.3-01, -03): a filter without products, and a store date that differs from the clock.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Menu from "@/components/Menu";
import OpenPreOrderNotice from "@/components/OpenPreOrderNotice";
import PromoCard from "@/components/PromoCard";
import StoreProvider from "@/components/StoreProvider";
import type { MenuFilter, StoreProduct } from "@/lib/menu";

const selected = vi.hoisted(() => ({ filter: "ALL" }));

// Menu's filter is its only state and starts at "ALL": start it at the filter under test, as if the chip had been clicked.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => react.useState(initial === "ALL" ? selected.filter : initial) };
});

const product = (name: string, type: StoreProduct["type"], orderDeadline: string | null = null): StoreProduct => ({
  id: name,
  name,
  category: "Kue",
  description: "",
  price: null,
  type,
  orderDeadline,
  tone: "butter",
  media: [],
});

const render = (products: StoreProduct[], today: string, children: ReactNode) => {
  const props = { products, today, children };
  return renderToStaticMarkup(createElement(StoreProvider, props));
};
const menu = (products: StoreProduct[], filter: MenuFilter) => {
  selected.filter = filter;
  return render(products, "2026-11-20", createElement(Menu, null, "Menu"));
};

afterEach(() => {
  selected.filter = "ALL";
  vi.useRealTimers();
});

describe("menu: a filter without products (D8)", () => {
  const NO_READY = "Belum ada produk ready stock saat ini.";
  const NO_PRE_ORDER = "Belum ada produk pre-order saat ini.";

  it.each([
    ["only ready stock, filter Pre-order", "READY_STOCK", "PRE_ORDER", "Pre-order", NO_PRE_ORDER, NO_READY],
    ["only pre-orders, filter Ready stock", "PRE_ORDER", "READY_STOCK", "Ready stock", NO_READY, NO_PRE_ORDER],
  ] as const)("%s: the text names the type, the chips stay, no card", (_, type, filter, chip, text, other) => {
    const html = menu([product("Kue Satu", type)], filter);
    expect(html).toContain(text);
    expect(html).not.toContain(other);
    expect(html.match(/aria-pressed=/g)).toHaveLength(3);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`aria-pressed="true"[^>]*>${chip}<`));
    expect(html).not.toContain("<li");
    expect(html).not.toContain("Chat WhatsApp");
  });

  it("the same products under Semua are a list, so the filter is what empties it", () => {
    const html = menu([product("Kue Satu", "READY_STOCK")], "ALL");
    expect(html.match(/<li/g)).toHaveLength(1);
    expect(html).not.toContain("Belum ada produk");
  });
});

// The server render uses the store's date as given; in the browser the store holds the browser's date (e2e/menu.spec.ts).
// The clock here says the pre-order is open, so a component that read the clock itself would show the phrase.
describe("notice bar phrase and promo card follow the store's date, not the clock (FR1)", () => {
  const PRODUCTS = [product("Soft Cookies", "READY_STOCK"), product("Hampers Natal", "PRE_ORDER", "2026-12-10")];
  const at = (today: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T03:00:00.000Z"));
    return render(PRODUCTS, today, [createElement(OpenPreOrderNotice, { key: "notice" }), createElement(PromoCard, { key: "promo" })]);
  };

  it("store date on the deadline day: the phrase and the promo card for that product", () => {
    const html = at("2026-12-10");
    expect(html).toContain("<strong>Open pre-order</strong>");
    expect(html).toContain("Pre-order dibuka");
    expect(html).toContain("Hampers Natal");
  });

  it("store date after the deadline: no phrase and no promo card", () => {
    expect(at("2026-12-11")).toBe("");
  });
});
