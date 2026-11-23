"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";
import Switch from "@/components/Switch";
import { setProductActive } from "./actions";
import styles from "./page.module.css";

// M3 plan D14 Switch: the "Tampil" column. The switch moves at once; on a failure it returns to the saved state and
// says so. The page keys it by the saved state, so a render with another saved state (another tab) starts it anew.
export default function ActiveSwitch({ productId, name, active }: { productId: string; name: string; active: boolean }) {
  const [checked, setChecked] = useState(active);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const change = (next: boolean) => {
    setChecked(next);
    setFailed(false);
    startTransition(async () => {
      let ok = false;
      try {
        ok = (await setProductActive(productId, next)).ok;
      } catch (error) {
        unstable_rethrow(error); // an expired session reaches the login by rejecting the action with a redirect
        // Otherwise the request never got an answer: offline, or dropped on the way.
      }
      if (!ok) {
        setChecked(!next);
        setFailed(true);
      }
    });
  };

  return (
    <div className={styles.switchCell}>
      <Switch checked={checked} onChange={change} pending={pending} aria-label={`Tampilkan ${name}`} />
      {failed && (
        <p className={styles.alert} role="alert">
          Perubahan belum tersimpan. Coba lagi.
        </p>
      )}
    </div>
  );
}
