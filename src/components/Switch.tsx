import type { ReactNode } from "react";
import styles from "./Switch.module.css";

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** A visible label beside the track; without one, `aria-label` names the switch. */
  label?: ReactNode;
  "aria-label"?: string;
  /** design.md §5 Pending (admin): a save is running. */
  pending?: boolean;
};

// design.md §5 Switch: 40×24 track, 18px knob, role="switch" with aria-checked. Controlled.
export default function Switch({ checked, onChange, label, pending, ...rest }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={pending || undefined}
      className={styles.switch}
      onClick={() => !pending && onChange(!checked)}
      {...rest}
    >
      <span className={styles.track} aria-hidden="true" />
      {label}
    </button>
  );
}
