"use client";

import { promoProduct } from "@/lib/menu";
import ProductThumb from "./ProductThumb";
import { useStore } from "./StoreProvider";
import styles from "./PromoCard.module.css";

// The floating card on the hero: the open pre-order with the nearest deadline (design.md §6 Hero).
// It opens that product's detail in M1.4.
export default function PromoCard() {
  const { products, today } = useStore();
  const product = promoProduct(products, today);
  if (!product) return null;
  return (
    <button type="button" className={styles.card}>
      <span className={styles.thumb}>
        <ProductThumb product={product} />
      </span>
      <span>
        <strong className={styles.name}>{product.name}</strong>
        <span className={styles.status}>
          <span className={styles.dot} aria-hidden="true" />
          Pre-order dibuka
        </span>
      </span>
    </button>
  );
}
