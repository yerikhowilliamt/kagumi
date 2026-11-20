"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setOrderStatus } from "@/app/admin/(protected)/pesanan/actions";
import type { OrderStatus } from "@/lib/orders";
import { STATUS_LABEL } from "./OrderStatusBadge";
import styles from "./StatusPicker.module.css";

const STATUSES = Object.keys(STATUS_LABEL) as OrderStatus[];

// design.md §7 Order detail, M2 plan D15: four toggle buttons, any status from any other (FR29). The pressed one
// comes from the server: the action revalidates the admin layout, and the transition ends with the new render.
export default function StatusPicker({ orderId, status }: { orderId: number; status: OrderStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<OrderStatus | null>(null);
  const [outcome, setOutcome] = useState<"saved" | "failed" | "not_found" | null>(null);

  function pick(next: OrderStatus) {
    // No check against `status`: this page can be stale (another tab), and the server decides (BSA-M2.5-02).
    if (pending) return;
    setPicked(next);
    setOutcome(null);
    startTransition(async () => {
      try {
        const result = await setOrderStatus(orderId, next);
        if (!result.ok) setOutcome(result.error === "not_found" ? "not_found" : "failed");
        else if (result.changed) setOutcome("saved");
        // Another tab already set this status: the action changed and revalidated nothing, so this page is stale.
        else router.refresh();
      } catch (error) {
        unstable_rethrow(error); // an expired session reaches the login by rejecting the action with a redirect
        setOutcome("failed"); // the request never got an answer: offline, or dropped on the way
      }
    });
  }

  return (
    <>
      {/* aria-disabled, not disabled: a disabled button would drop keyboard focus mid-change (K8). */}
      <div className={styles.picker} role="group" aria-label="Ubah status" aria-busy={pending}>
        {STATUSES.map((option) => {
          const saving = pending && option === picked;
          return (
            <button
              key={option}
              type="button"
              className={styles.option}
              aria-pressed={option === status}
              aria-disabled={pending}
              data-saving={saving || undefined}
              onClick={() => pick(option)}
            >
              <i className={styles[option]} aria-hidden="true" />
              {STATUS_LABEL[option]}
              {/* Hidden from the name, so the button stays "Dikonfirmasi" for a screen reader while it saves. */}
              {saving && (
                <span className={styles.saving} aria-hidden="true">
                  Menyimpan…
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* Always in the page: a live region announces a change only when it existed before the change. */}
      <p className={styles.status} role="status">
        {!pending && outcome === "saved" && picked ? `Status diubah ke ${STATUS_LABEL[picked]}.` : ""}
      </p>
      {(outcome === "failed" || outcome === "not_found") && (
        <p className={styles.alert} role="alert">
          {outcome === "not_found" ? "Pesanan ini tidak ditemukan." : "Status belum tersimpan. Coba lagi."}
        </p>
      )}
    </>
  );
}
