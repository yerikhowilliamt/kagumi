"use client";

import { useState, useTransition } from "react";
import { setOrderStatus } from "@/app/admin/(protected)/pesanan/actions";
import type { OrderStatus } from "@/lib/orders";
import { STATUS_LABEL } from "./OrderStatusBadge";
import styles from "./StatusPicker.module.css";

const STATUSES = Object.keys(STATUS_LABEL) as OrderStatus[];

// design.md §7 Order detail, M2 plan D15: four toggle buttons, any status from any other (FR29). The pressed one
// comes from the server: the action revalidates the admin layout, and the transition ends with the new render.
export default function StatusPicker({ orderId, status }: { orderId: number; status: OrderStatus }) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function pick(next: OrderStatus) {
    if (pending || next === status) return;
    setFailed(false);
    startTransition(async () => {
      const result = await setOrderStatus(orderId, next);
      if (!result.ok) setFailed(true);
    });
  }

  return (
    <>
      {/* aria-disabled, not disabled: a disabled button would drop keyboard focus mid-change (K8). */}
      <div className={styles.picker} role="group" aria-label="Ubah status" aria-busy={pending}>
        {STATUSES.map((option) => (
          <button
            key={option}
            type="button"
            className={styles.option}
            aria-pressed={option === status}
            aria-disabled={pending}
            onClick={() => pick(option)}
          >
            <i className={styles[option]} aria-hidden="true" />
            {STATUS_LABEL[option]}
          </button>
        ))}
      </div>
      {failed && (
        <p className={styles.alert} role="alert">
          Status belum tersimpan. Coba lagi.
        </p>
      )}
    </>
  );
}
