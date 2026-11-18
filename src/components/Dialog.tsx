"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Dialog.module.css";

// design.md §6 and §8: a native <dialog> opened with showModal(), so the browser traps focus, makes the page inert,
// closes on Esc and puts focus back on the control that opened it. ✕ and a backdrop click close it too.
// `modal`: centered, a bottom sheet at ≤ 760px (product detail). `side`: right-side panel, full width on mobile (cart).
export default function Dialog({
  open,
  onClose,
  labelledBy,
  variant = "modal",
  children,
}: {
  open: boolean;
  /** Called after the dialog closed, whatever closed it. */
  onClose: () => void;
  /** The id of the dialog's heading. */
  labelledBy: string;
  variant?: "modal" | "side";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles[variant]}`}
      aria-labelledby={labelledBy}
      onClose={onClose}
      // The dialog's own box is covered by its content, so a click whose target is the dialog hit the backdrop.
      onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
    >
      <button type="button" className={styles.close} aria-label="Tutup" onClick={() => ref.current!.close()}>
        <span aria-hidden="true">✕</span>
      </button>
      {children}
    </dialog>
  );
}
