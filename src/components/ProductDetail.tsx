"use client";

import { useId, useState } from "react";
import { formatDateShort, formatRupiah, isClosed } from "@/lib/order";
import Button from "./Button";
import Dialog from "./Dialog";
import ProductThumb from "./ProductThumb";
import QuantityStepper from "./QuantityStepper";
import { useStore } from "./StoreProvider";
import Tag from "./Tag";
import styles from "./ProductDetail.module.css";

// design.md §6 Product detail (FR6). Rendered once by the page; the store says which product it shows.
// No media until M3, so the gallery is the placeholder alone, without a thumbnail row (D9).
export default function ProductDetail() {
  const { selected: product, detailOpen, closeDetail, today } = useStore();
  const titleId = useId();
  const [qty, setQty] = useState(1);
  // Every opening starts the stepper at 1.
  const [wasOpen, setWasOpen] = useState(detailOpen);
  if (detailOpen !== wasOpen) {
    setWasOpen(detailOpen);
    if (detailOpen) setQty(1);
  }

  if (!product) return null;
  const closed = isClosed(product.orderDeadline, today);

  return (
    <Dialog open={detailOpen} onClose={closeDetail} labelledBy={titleId}>
      <div className={styles.gallery}>
        <div className={styles.main}>
          <ProductThumb product={product} />
        </div>
      </div>
      <div className={styles.info}>
        <Tag type={product.type} detail />
        <h2 id={titleId} className={styles.title}>
          {product.name}
        </h2>
        {product.price === null ? (
          <p className={`${styles.price} ${styles.ask}`}>Harga dikonfirmasi via WhatsApp</p>
        ) : (
          <p className={styles.price}>{formatRupiah(product.price)}</p>
        )}
        {product.description && <p className={styles.desc}>{product.description}</p>}
        {product.orderDeadline && (
          <p className={styles.deadline}>Batas order {formatDateShort(product.orderDeadline)}</p>
        )}
        {/* Preview draft copy (D10), owner review in M5. */}
        <ul className={styles.facts} role="list">
          <li>
            <span className={styles.factLabel}>Pengambilan:</span> ambil sendiri atau diantar (area Solo)
          </li>
          <li>
            <span className={styles.factLabel}>Dibuat:</span> fresh setelah pesanan dikonfirmasi
          </li>
        </ul>
        <div className={styles.buy}>
          {closed ? (
            <p className={styles.closed}>Order sudah ditutup</p>
          ) : (
            <>
              <QuantityStepper value={qty} min={1} max={50} onChange={setQty} name={product.name} size="lg" />
              {/* Adds to the cart in M1.5. */}
              <Button size="md" block>
                Tambah ke keranjang
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
