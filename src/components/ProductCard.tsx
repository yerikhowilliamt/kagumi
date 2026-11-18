import type { StoreProduct } from "@/lib/menu";
import { formatDateShort, formatRupiah } from "@/lib/order";
import ProductThumb from "./ProductThumb";
import Tag from "./Tag";
import styles from "./ProductCard.module.css";

// design.md §6 Product card. The thumbnail opens the detail in M1.4; the add button adds to the cart in M1.5.
export default function ProductCard({ product, closed }: { product: StoreProduct; closed: boolean }) {
  return (
    <li className={styles.item}>
      <div className={styles.media}>
        <button
          type="button"
          className={closed ? `${styles.thumb} ${styles.closed}` : styles.thumb}
          aria-label={`Lihat detail ${product.name}`}
        >
          <ProductThumb product={product} />
        </button>
        {/* Beside the button, not inside: the button's label would hide the tag from screen readers. */}
        <span className={styles.tag}>
          <Tag type={product.type} />
        </span>
      </div>
      <p className={styles.category}>{product.category}</p>
      <div className={styles.meta}>
        <h3 className={styles.name}>{product.name}</h3>
        {product.price === null ? (
          <p className={`${styles.price} ${styles.ask}`}>Harga via WA</p>
        ) : (
          <p className={styles.price}>{formatRupiah(product.price)}</p>
        )}
      </div>
      {product.description && <p className={styles.desc}>{product.description}</p>}
      {product.orderDeadline && <p className={styles.deadline}>Batas order {formatDateShort(product.orderDeadline)}</p>}
      {closed ? (
        <p className={`${styles.add} ${styles.closedNote}`}>Order sudah ditutup</p>
      ) : (
        <button type="button" className={`${styles.add} ${styles.addButton}`}>
          + Tambah ke keranjang
        </button>
      )}
    </li>
  );
}
