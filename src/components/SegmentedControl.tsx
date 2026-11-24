import styles from "./SegmentedControl.module.css";

// design.md §5 Segmented control: storefront variant (equal-width options with an optional second line) or admin
// variant (auto-width 32px pills); aria-pressed.
export default function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  admin,
}: {
  /** The group's accessible name. */
  label: string;
  options: { value: T; label: string; sub?: string }[];
  value: T;
  onChange: (value: T) => void;
  /** The admin pill variant. */
  admin?: boolean;
}) {
  return (
    <div className={admin ? `${styles.seg} ${styles.admin}` : styles.seg} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.option}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.sub && <small className={styles.sub}>{option.sub}</small>}
        </button>
      ))}
    </div>
  );
}
