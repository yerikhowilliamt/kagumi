import type { StoreProduct } from "./menu";
import { MAX_LINES, MAX_QTY, type OrderLine } from "./order";

// The cart in `localStorage['kagumi-cart']` (FR9, D21). Prices and names are never stored: they come from the page.
export type CartLine = { id: string; qty: number };

export const CART_KEY = "kagumi-cart";

const clamp = (qty: number) => Math.min(MAX_QTY, Math.max(1, Math.trunc(qty)));

/** D21 load rules: invalid JSON or a non-array → [], unknown ids dropped, qty 1–50, duplicates merged, at most 20 lines. */
export function parseCart(raw: string | null, knownIds: ReadonlySet<string>): CartLine[] {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const merged = new Map<string, number>();
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const { id, qty } = item as Record<string, unknown>;
    if (typeof id !== "string" || !knownIds.has(id) || typeof qty !== "number" || !Number.isFinite(qty)) continue;
    merged.set(id, clamp((merged.get(id) ?? 0) + clamp(qty)));
  }
  return [...merged].slice(0, MAX_LINES).map(([id, qty]) => ({ id, qty }));
}

/** Adds `qty` of a product, capped at 50. A new product beyond 20 lines gives "full". */
export function addLine(lines: CartLine[], id: string, qty: number): CartLine[] | "full" {
  if (lines.some((l) => l.id === id)) return lines.map((l) => (l.id === id ? { id, qty: clamp(l.qty + qty) } : l));
  if (lines.length >= MAX_LINES) return "full";
  return [...lines, { id, qty: clamp(qty) }];
}

/** 0 or less removes the line (the cart stepper's minimum). */
export const setQty = (lines: CartLine[], id: string, qty: number) =>
  qty < 1 ? removeLine(lines, id) : lines.map((l) => (l.id === id ? { id, qty: clamp(qty) } : l));

export const removeLine = (lines: CartLine[], id: string) => lines.filter((l) => l.id !== id);

export const serializeCart = (lines: CartLine[]) => JSON.stringify(lines.map(({ id, qty }) => ({ id, qty })));

/** The lines with the page's names and prices, for `summarize`. Lines of products not on the page are skipped. */
export const toOrderLines = (lines: CartLine[], products: StoreProduct[]): OrderLine[] =>
  lines.flatMap(({ id, qty }) => {
    const p = products.find((x) => x.id === id);
    return p ? [{ name: p.name, unitPrice: p.price, quantity: qty }] : [];
  });
