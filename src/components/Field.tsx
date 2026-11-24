import { useId, type ComponentProps, type ReactNode } from "react";
import styles from "./Field.module.css";

type Common = {
  label: ReactNode;
  helper?: ReactNode;
  /** The validation message; sets `aria-invalid` and is announced with the field. */
  error?: string;
  /** The admin height (44px) instead of the storefront's 46px (M2 plan D22). */
  admin?: boolean;
  /** Muted text inside the left padding, e.g. "Rp" (design.md §5 Inputs). Inputs only. */
  prefix?: string;
};

type Props = Common &
  (({ multiline: true } & Omit<ComponentProps<"textarea">, "className" | "id">) | ({ multiline?: false } & Omit<ComponentProps<"input">, "className" | "id">));

// design.md §5 Inputs: label above, helper and error below.
export default function Field({ label, helper, error, admin, prefix, multiline, ...rest }: Props) {
  const id = useId();
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const describedBy = [helper && helperId, error && errorId].filter(Boolean).join(" ") || undefined;
  const control = {
    id,
    className: admin ? `${styles.input} ${styles.admin}` : styles.input,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  };
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {multiline ? (
        <textarea {...control} {...(rest as ComponentProps<"textarea">)} />
      ) : prefix ? (
        <span className={styles.prefix}>
          <span aria-hidden="true">{prefix}</span>
          <input {...control} {...(rest as ComponentProps<"input">)} />
        </span>
      ) : (
        <input {...control} {...(rest as ComponentProps<"input">)} />
      )}
      {helper && (
        <small id={helperId} className={styles.helper}>
          {helper}
        </small>
      )}
      {error && (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      )}
    </div>
  );
}
