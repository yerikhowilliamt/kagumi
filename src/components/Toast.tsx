"use client";

import { useEffect, useState } from "react";
import { useStore } from "./StoreProvider";
import styles from "./Toast.module.css";

// design.md §6 Toast and §4 Motion: shows on add, hides after 2.6 s, paused while hovered or focused.
// Opening a dialog clears it in the store. The element stays mounted so the status region is always there.
export default function Toast() {
  const { toast, hideToast, openCart } = useStore();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  useEffect(() => {
    if (!toast || paused) return;
    const timer = setTimeout(hideToast, 2600);
    return () => clearTimeout(timer);
  }, [toast, paused, hideToast]);

  return (
    <div
      className={toast ? `${styles.toast} ${styles.show}` : styles.toast}
      role="status"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {toast && (
        <>
          <span>{toast.text}</span>
          <button type="button" className={styles.action} onClick={openCart}>
            Lihat keranjang
          </button>
        </>
      )}
    </div>
  );
}
