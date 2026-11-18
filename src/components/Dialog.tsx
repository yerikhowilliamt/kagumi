"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import styles from "./Dialog.module.css";

const outside = (e: MouseEvent<HTMLDialogElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom;
};

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
  const pressedOutside = useRef(false);

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
      // A backdrop click is pressed and released outside the dialog's box. A drag that starts inside, or a click on
      // panel space the content leaves uncovered (`side`), also targets the dialog, so the target alone is not enough.
      onPointerDown={(e) => (pressedOutside.current = outside(e))}
      onClick={(e) => e.target === e.currentTarget && pressedOutside.current && outside(e) && e.currentTarget.close()}
    >
      <button type="button" className={styles.close} aria-label="Tutup" onClick={() => ref.current!.close()}>
        <span aria-hidden="true">✕</span>
      </button>
      {children}
    </dialog>
  );
}
