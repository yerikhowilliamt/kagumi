import type { OrderStatus } from "@/lib/orders";
import styles from "./OrderStatusBadge.module.css";

// The Indonesian labels of the order statuses (PRD FR29).
export const STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: "Baru",
  CONFIRMED: "Dikonfirmasi",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

// design.md §5 Tags & status: the order status badge, always with its text label (§8).
export default function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`${styles.badge} ${styles[status]}`}>{STATUS_LABEL[status]}</span>;
}
