"use client";

import { unstable_rethrow } from "next/navigation";
import { startTransition, useActionState, useState } from "react";
import Button from "@/components/Button";
import Dialog from "@/components/Dialog";
import { deleteProduct } from "./actions";
import styles from "./form.module.css";

type Result = Awaited<ReturnType<typeof deleteProduct>>;

// FR27, design.md §7 Product form: Danger "Hapus produk" opens the delete confirmation. "Batal" is the dialog's first
// control, so showModal() focuses it and Enter never deletes by accident (§8). Success redirects to the list; a failure keeps the dialog open with the
// approved message (M3 plan D18).
export default function DeleteProduct({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  // The attempt count when the dialog last opened: an old failure is not shown again on the next open (BSA-M3.3-02).
  const [openedAt, setOpenedAt] = useState(0);
  // attempt keys the alert, so a repeated failure is announced again (as ProductForm).
  const [state, dispatch, pending] = useActionState(async (prev: { result: Result; attempt: number } | null) => {
    let result: Result;
    try {
      result = await deleteProduct(id);
    } catch (error) {
      unstable_rethrow(error); // the redirect to the list, or to the login when the session expired
      result = { ok: false, error: "server" }; // no answer: offline, or dropped on the way
    }
    return { result, attempt: (prev?.attempt ?? 0) + 1 };
  }, null);
  return (
    <>
      <Button
        variant="danger"
        size="nav"
        onClick={() => {
          setOpenedAt(state?.attempt ?? 0);
          setOpen(true);
        }}
      >
        Hapus produk
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} labelledBy="delete-title" variant="confirm">
        <h2 id="delete-title" className={styles.confirmTitle}>
          Hapus {name}?
        </h2>
        <p className={styles.confirmText}>Produk beserta semua foto dan videonya akan dihapus permanen. Pesanan lama tetap tersimpan.</p>
        {state && state.attempt > openedAt && !pending && (
          <p key={state.attempt} className={styles.alert} role="alert">
            Perubahan belum tersimpan. Coba lagi.
          </p>
        )}
        <div className={styles.confirmActions}>
          <Button variant="line" size="nav" onClick={() => setOpen(false)}>
            Batal
          </Button>
          <Button variant="danger" size="nav" aria-busy={pending || undefined} onClick={() => !pending && startTransition(() => dispatch())}>
            {pending ? "Menghapus…" : "Hapus"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
