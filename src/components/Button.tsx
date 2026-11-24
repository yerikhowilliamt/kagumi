import type { ComponentProps, ReactNode } from "react";
import styles from "./Button.module.css";

type Common = {
  variant?: "primary" | "line" | "butter" | "whatsapp" | "danger" | "text";
  /** lg 50px (storefront), md 46px (sheet, detail), nav 42px, sm 34px. Ignored by the text variant. */
  size?: "lg" | "md" | "nav" | "sm";
  /** Full width, for sheets. */
  block?: boolean;
  /** Trailing arrow that nudges on hover. */
  arrow?: boolean;
  children: ReactNode;
};

type Props = Common &
  (({ href: string } & Omit<ComponentProps<"a">, "className">) | ({ href?: undefined } & Omit<ComponentProps<"button">, "className">));

// design.md §5 Buttons: a link when it has an href, a button otherwise.
export default function Button({ variant = "primary", size = "lg", block, arrow, children, ...rest }: Props) {
  const className = [styles.btn, styles[size], styles[variant], block && styles.block].filter(Boolean).join(" ");
  const content = (
    <>
      {children}
      {arrow && (
        <span className={styles.arrow} aria-hidden="true">
          →
        </span>
      )}
    </>
  );
  if (rest.href === undefined) {
    return (
      <button type="button" className={className} {...rest}>
        {content}
      </button>
    );
  }
  return (
    <a className={className} {...rest}>
      {content}
    </a>
  );
}
