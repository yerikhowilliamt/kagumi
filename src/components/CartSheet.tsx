"use client";

import { useId } from "react";
import { toOrderLines } from "@/lib/cart";
import { MAX_QTY, formatRupiah, summarize } from "@/lib/order";
import Button from "./Button";
import { CART_BUTTON_ID } from "./CartButton";
import Dialog from "./Dialog";
import ProductThumb from "./ProductThumb";
import QuantityStepper from "./QuantityStepper";
import { useStore } from "./StoreProvider";
import styles from "./CartSheet.module.css";

// design.md §6 Cart sheet, step 1 (FR8, FR10). "Lanjut isi data" and the later steps come in M1.7.
export default function CartSheet() {
  const { lines, products, cartOpen, closeCart, setLineQty, removeFromCart } = useStore();
  const titleId = useId();
  const items = lines.flatMap((line) => {
    const product = products.find((p) => p.id === line.id);
    return product ? [{ ...line, product }] : [];
  });
  const { subtotal, unpriced } = summarize(toOrderLines(lines, products));

  return (
    <Dialog
      open={cartOpen}
      onClose={() => {
        closeCart();
        // The opener may be gone (the cart bar unmounts when the cart empties): the browser then leaves focus on
        // <body> or on a control inside the closed sheet ("Lihat menu"), so it goes to the nav cart button (TR-M1.5-08).
        const focused = document.activeElement;
        if (!focused || focused === document.body || focused.closest("dialog:not([open])")) {
          document.getElementById(CART_BUTTON_ID)?.focus();
        }
      }}
      labelledBy={titleId}
      variant="side"
    >
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          Keranjang
        </h2>
        <p className={styles.steps}>
          <b>1 Keranjang</b> → 2 Data pemesan
        </p>
      </div>

      {items.length === 0 ? (
        <div className={styles.body}>
          <div className={styles.empty}>
            <span className={styles.burst} aria-hidden="true" />
            <p className={styles.emptyTitle}>Keranjang masih kosong</p>
            {/* Preview draft copy (D10). */}
            <p>Pilih menu favoritmu dulu, ya.</p>
            <Button variant="line" size="md" onClick={closeCart}>
              Lihat menu
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ul className={styles.body} role="list">
            {items.map(({ id, qty, product }) => (
              <li key={id} className={styles.line}>
                <span className={styles.thumb}>
                  <ProductThumb product={product} />
                </span>
                <div>
                  <p className={styles.name}>{product.name}</p>
                  <p className={styles.small}>
                    {product.price === null ? "Harga via WA" : formatRupiah(product.price)} ·{" "}
                    {product.type === "PRE_ORDER" ? "Pre-order" : "Ready stock"}
                  </p>
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={`Hapus ${product.name}`}
                    onClick={() => removeFromCart(id)}
                  >
                    Hapus
                  </button>
                </div>
                <div className={styles.right}>
                  <span className={styles.total}>{product.price === null ? "—" : formatRupiah(product.price * qty)}</span>
                  <QuantityStepper
                    value={qty}
                    min={0}
                    max={MAX_QTY}
                    onChange={(q) => setLineQty(id, q)}
                    name={product.name}
                  />
                </div>
              </li>
            ))}
          </ul>
          <div className={styles.foot}>
            <p className={styles.sum}>
              <span>Subtotal</span>
              <span>{unpriced < items.length ? formatRupiah(subtotal) : "—"}</span>
            </p>
            {/* The delivery note is preview draft copy (D10). */}
            <p className={styles.note}>
              {unpriced
                ? `+ ${unpriced} produk tanpa harga, dikonfirmasi lewat WhatsApp`
                : "Ongkir (jika diantar) dikonfirmasi lewat WhatsApp."}
            </p>
          </div>
        </>
      )}
    </Dialog>
  );
}
