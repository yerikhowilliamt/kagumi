import type { StoreProduct } from "@/lib/menu";
import styles from "./Tag.module.css";

// design.md §5 Tags & status: the storefront thumbnail tags.
export default function Tag({ type }: { type: StoreProduct["type"] }) {
  const preOrder = type === "PRE_ORDER";
  return <span className={`${styles.tag} ${preOrder ? styles.po : styles.ready}`}>{preOrder ? "Pre-order" : "Ready stock"}</span>;
}
