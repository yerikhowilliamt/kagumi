"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { StoreProduct } from "@/lib/menu";
import { jakartaToday } from "@/lib/order";

type Store = {
  /** Active products in sortOrder, as the static page read them. */
  products: StoreProduct[];
  /** The WIB date as `YYYY-MM-DD`. */
  today: string;
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
  return <StoreContext value={{ products, today: browserToday }}>{children}</StoreContext>;
}
