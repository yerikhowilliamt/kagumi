"use client";

import Link from "next/link";
import LinkPending from "./LinkPending";
import { usePathname } from "next/navigation";
import styles from "./AdminNav.module.css";

// design.md §7 Shell. Only pages that exist (M2 plan D6); M3 and M4 add their items here.
const ITEMS = [
  {
    href: "/admin/pesanan",
    label: "Pesanan",
    icon: (
      <>
        <path d="M5 8h14l-1 12H6z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </>
    ),
  },
];

/** `side`: the sidebar list, "Pesanan" with the NEW count pill (hidden at 0, D17). `bottom`: the mobile nav. */
export default function AdminNav({ variant, newOrders }: { variant: "side" | "bottom"; newOrders: number }) {
  const pathname = usePathname();
  return (
    <nav className={styles[variant]} aria-label="Menu admin">
      {ITEMS.map(({ href, label, icon }) => (
        <Link
          key={href}
          href={href}
          className={styles.item}
          aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}
        >
          <LinkPending />
          <svg aria-hidden="true" viewBox="0 0 24 24">
            {icon}
          </svg>
          {label}
          {variant === "side" && href === "/admin/pesanan" && newOrders > 0 && (
            <span className={styles.count}>{newOrders}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
