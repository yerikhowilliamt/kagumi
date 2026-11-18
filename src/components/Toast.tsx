"use client";

import { useEffect, useState } from "react";
import { CART_BUTTON_ID } from "./CartButton";
import { useStore } from "./StoreProvider";
import styles from "./Toast.module.css";

// design.md §6 Toast and §4 Motion: shows on add, hides after 2.6 s, paused while hovered or focused.
// Opening a dialog clears it in the store. The element stays mounted so the status region is always there.
export default function Toast() {
  const { toast, hideToast, openCart } = useStore();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // The last toast stays rendered after a hide, so the pill fades out; the CSS hides it once faded (TR-M1.5-01).
  const [last, setLast] = useState(toast);
  if (toast && toast !== last) setLast(toast);
  const shown = toast ?? last;
  // Clearing the toast hides its button while focused or hovered, and React then never runs onBlur/onPointerLeave,
  // so the flags are reset here or the next toast would never hide (BSA-M1.5-01).
  if (!toast && (hovered || focused)) {
    setHovered(false);
    setFocused(false);
  }
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
      {shown && (
        <>
          {/* A new node per toast, so the status region announces a repeated text too. */}
          <span key={shown.key}>{shown.text}</span>
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              // This button hides, so the sheet would have no control to return focus to (TR-M1.5-03).
              document.getElementById(CART_BUTTON_ID)?.focus();
              openCart();
            }}
          >
            Lihat keranjang
          </button>
        </>
      )}
    </div>
  );
}
