import type { StoreProduct } from "@/lib/menu";
import styles from "./Tag.module.css";

type Props = { type: StoreProduct["type"]; detail?: boolean; hidden?: false } | { hidden: true; type?: undefined; detail?: undefined };

// design.md §5 Tags & status: the storefront thumbnail tags, or the admin/detail style (`detail`), or the admin
// "Disembunyikan" tag (`hidden`).
export default function Tag({ type, detail, hidden }: Props) {
  if (hidden) return <span className={`${styles.tag} ${styles.hidden}`}>Disembunyikan</span>;
  const preOrder = type === "PRE_ORDER";
  const className = [styles.tag, preOrder ? styles.po : styles.ready, detail && styles.detail].filter(Boolean).join(" ");
  return <span className={className}>{preOrder ? "Pre-order" : "Ready stock"}</span>;
}
