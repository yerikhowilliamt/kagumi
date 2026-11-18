"use client";

import { toOrderLines } from "@/lib/cart";
import { formatRupiah, summarize } from "@/lib/order";
import { useStore } from "./StoreProvider";
import styles from "./CartBar.module.css";

// design.md §6 Mobile cart bar: ≤ 640px (CSS), only with items. The chip texts are preview drafts (D10).
export default function CartBar() {
  const { lines, products, openCart } = useStore();
  if (lines.length === 0) return null;
  const count = lines.reduce((sum, l) => sum + l.qty, 0);
  const { subtotal, unpriced } = summarize(toOrderLines(lines, products));
  return (
    <button type="button" className={styles.bar} onClick={openCart}>
      <span>Lihat keranjang · {count} item</span>
      <b className={styles.chip}>{unpriced < lines.length ? `${formatRupiah(subtotal)}${unpriced ? "+" : ""}` : "Harga via WA"}</b>
    </button>
  );
}
