"use client";

import { useStore } from "./StoreProvider";
import styles from "./CartButton.module.css";

// design.md §6 Navigation: round icon button with the bag glyph and a count badge hidden at 0 (D10 name).
export default function CartButton() {
  const { lines, openCart } = useStore();
  const count = lines.reduce((sum, l) => sum + l.qty, 0);
  return (
    <button
      type="button"
      className={styles.button}
      aria-label={count ? `Buka keranjang, ${count} item` : "Buka keranjang"}
      onClick={openCart}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
        <path d="M5 8h14l-1 12H6z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </svg>
      {count > 0 && (
        <span className={styles.badge} aria-hidden="true">
          {count}
        </span>
      )}
    </button>
  );
}
