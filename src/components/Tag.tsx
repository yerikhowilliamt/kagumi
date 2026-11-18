import type { StoreProduct } from "@/lib/menu";
import styles from "./Tag.module.css";

// design.md §5 Tags & status: the storefront thumbnail tags, or the detail style.
export default function Tag({ type, detail }: { type: StoreProduct["type"]; detail?: boolean }) {
  const preOrder = type === "PRE_ORDER";
  const className = [styles.tag, preOrder ? styles.po : styles.ready, detail && styles.detail].filter(Boolean).join(" ");
  return <span className={className}>{preOrder ? "Pre-order" : "Ready stock"}</span>;
}
