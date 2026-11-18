import styles from "./QuantityStepper.module.css";

// design.md §5 Quantity stepper: − / count / +, 34px (cart line) or 46px (product detail).
// At a limit the button is aria-disabled, not disabled, so a focused button keeps focus inside its dialog.
export default function QuantityStepper({
  value,
  min,
  max,
  onChange,
  name,
  size = "sm",
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** The product name, for the button labels. */
  name: string;
  size?: "sm" | "lg";
}) {
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <div className={`${styles.stepper} ${styles[size]}`} role="group" aria-label="Jumlah">
      <button
        type="button"
        className={styles.button}
        aria-label={`Kurangi ${name}`}
        aria-disabled={atMin}
        onClick={() => !atMin && onChange(value - 1)}
      >
        <span aria-hidden="true">−</span>
      </button>
      <output className={styles.count}>{value}</output>
      <button
        type="button"
        className={styles.button}
        aria-label={`Tambah ${name}`}
        aria-disabled={atMax}
        onClick={() => !atMax && onChange(value + 1)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
