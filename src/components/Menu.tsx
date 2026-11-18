"use client";

import { useState, type ReactNode } from "react";
import { filterMenu, menuState, sortForMenu, type MenuFilter } from "@/lib/menu";
import { isClosed, SHOP_WHATSAPP } from "@/lib/order";
import Button from "./Button";
import ProductCard from "./ProductCard";
import { useStore } from "./StoreProvider";
import styles from "./Menu.module.css";

const CHIPS: [MenuFilter, string][] = [
  ["ALL", "Semua"],
  ["READY_STOCK", "Ready stock"],
  ["PRE_ORDER", "Pre-order"],
];

// The menu section body. `children` is the server-rendered section heading; the chips sit beside it.
// Closed products are worked out here, in the browser, because the page is cached (System Design §4.2).
export default function Menu({ children }: { children: ReactNode }) {
  const { products, today } = useStore();
  const [filter, setFilter] = useState<MenuFilter>("ALL");
  const state = menuState(products, filter);

  return (
    <>
      <div className={styles.head}>
        {children}
        {state !== "empty" && (
          <div className={styles.chips} role="group" aria-label="Filter menu">
            {CHIPS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={styles.chip}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {state === "empty" && (
        <div className={styles.empty}>
          <p className={styles.emptyText}>Menu sedang kami siapkan. Untuk pesan sekarang, chat kami di WhatsApp.</p>
          <Button variant="line" href={`https://wa.me/${SHOP_WHATSAPP}`}>
            Chat WhatsApp
          </Button>
        </div>
      )}

      {state === "no-match" && (
        <p className={styles.emptyText}>
          {filter === "READY_STOCK" ? "Belum ada produk ready stock saat ini." : "Belum ada produk pre-order saat ini."}
        </p>
      )}

      {state === "list" && (
        // role: list-style none drops the list semantics in Safari.
        <ul className={styles.grid} role="list">
          {sortForMenu(filterMenu(products, filter), today).map((product) => (
            <ProductCard key={product.id} product={product} closed={isClosed(product.orderDeadline, today)} />
          ))}
        </ul>
      )}
    </>
  );
}
