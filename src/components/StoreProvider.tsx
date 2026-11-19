"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { addOutcome, CART_KEY, parseCart, removeLine, serializeCart, setQty, type CartLine } from "@/lib/cart";
import type { StoreProduct } from "@/lib/menu";
import { jakartaToday } from "@/lib/order";

type Store = {
  /** Active products in sortOrder, as the static page read them. */
  products: StoreProduct[];
  /** The WIB date as `YYYY-MM-DD`. */
  today: string;
  /** The product in the detail dialog. It stays set after closing, so the dialog keeps its content while it fades out. */
  selected: StoreProduct | null;
  detailOpen: boolean;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  /** Cart lines (FR8, FR9), empty until loaded from storage after mount. */
  lines: CartLine[];
  cartOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  addToCart: (id: string, qty: number) => void;
  setLineQty: (id: string, qty: number) => void;
  removeFromCart: (id: string) => void;
  /** Only after a saved checkout: a failed one keeps the cart (FR14). */
  clearCart: () => void;
  /** `key` changes on every show, so the same text restarts the toast's timer. */
  toast: { text: string; key: number } | null;
  hideToast: () => void;
};

const StoreContext = createContext<Store | null>(null);

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside StoreProvider");
  return store;
}

// The date has no change event of its own. It is read again when the tab becomes visible,
// so a page left open past a deadline closes the product without a reload (BSA-M1.3-02).
// shortcut: a tab that stays visible across WIB midnight keeps the old date until it is hidden and shown again;
// add a timer if that case starts to matter (the server re-checks at checkout either way).
const subscribe = (notify: () => void) => {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
};

export default function StoreProvider({
  products,
  today,
  children,
}: {
  products: StoreProduct[];
  /** The WIB date when the server rendered the page. */
  today: string;
  children: ReactNode;
}) {
  // D22: hydration renders with the server's date, so the markup matches; the browser's WIB date takes over right after.
  const browserToday = useSyncExternalStore(subscribe, jakartaToday, () => today);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [toast, setToast] = useState<Store["toast"]>(null);

  // After mount, so the server markup and hydration see an empty cart.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(CART_KEY);
    } catch {
      // Storage blocked: the cart lives for this page view only.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable after hydration
    setLines(parseCart(saved, new Set(products.map((p) => p.id))));
  }, [products]);

  // Saved here, not in an effect, so the empty first render never overwrites the stored cart.
  const save = (next: CartLine[]) => {
    setLines(next);
    try {
      localStorage.setItem(CART_KEY, serializeCart(next));
    } catch {
      // Storage blocked: kept in memory.
    }
  };
  // Stable, so the toast's timer effect does not restart on every store render.
  const hideToast = useCallback(() => setToast(null), []);
  const showToast = (text: string) => setToast((t) => ({ text, key: (t?.key ?? 0) + 1 }));

  const store: Store = {
    products,
    today: browserToday,
    selected: products.find((p) => p.id === selectedId) ?? null,
    detailOpen,
    openDetail: (id) => {
      setSelectedId(id);
      setDetailOpen(true);
      setToast(null);
    },
    closeDetail: () => setDetailOpen(false),
    lines,
    cartOpen,
    openCart: () => {
      setDetailOpen(false);
      setCartOpen(true);
      setToast(null);
    },
    closeCart: () => setCartOpen(false),
    addToCart: (id, qty) => {
      const result = addOutcome(lines, id, qty, products.find((p) => p.id === id)?.name ?? "");
      if (result.lines) save(result.lines);
      if (result.toast) showToast(result.toast);
    },
    setLineQty: (id, qty) => save(setQty(lines, id, qty)),
    removeFromCart: (id) => save(removeLine(lines, id)),
    clearCart: () => save([]),
    toast,
    hideToast,
  };
  return <StoreContext value={store}>{children}</StoreContext>;
}
