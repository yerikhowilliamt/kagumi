"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toOrderLines } from "@/lib/cart";
import { isClosed, MAX_QTY, formatRupiah, summarize } from "@/lib/order";
import Button from "./Button";
import { CART_BUTTON_ID } from "./CartButton";
import CheckoutForm, { EMPTY_VALUES, type CheckoutValues } from "./CheckoutForm";
import Dialog from "./Dialog";
import OrderResult, { type OrderOutcome } from "./OrderResult";
import ProductThumb from "./ProductThumb";
import QuantityStepper from "./QuantityStepper";
import { useStore } from "./StoreProvider";
import styles from "./CartSheet.module.css";

type Step = "cart" | "form" | "result";
type Reason = "closed" | "unavailable";

const TITLES = { cart: "Keranjang", form: "Data pemesan" } as const;
const REASONS: Record<Reason, string> = { closed: "Order sudah ditutup", unavailable: "Produk tidak tersedia" };

// design.md §6 Cart sheet: cart → form → result in one dialog (FR8–FR14).
export default function CartSheet() {
  const { lines, products, today, cartOpen, closeCart, setLineQty, removeFromCart, clearCart } = useStore();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<Step>("cart");
  const [values, setValues] = useState<CheckoutValues>(EMPTY_VALUES);
  // Reasons the server gave (FR12). Lines past their deadline in the browser are marked without it (D21).
  const [rejected, setRejected] = useState<ReadonlyMap<string, Reason>>(new Map());
  const [itemsInvalid, setItemsInvalid] = useState(false);
  const [outcome, setOutcome] = useState<OrderOutcome | null>(null);

  const items = lines.flatMap((line) => {
    const product = products.find((p) => p.id === line.id);
    return product ? [{ ...line, product }] : [];
  });
  const reasonOf = (id: string, deadline: string | null) => rejected.get(id) ?? (isClosed(deadline, today) ? "closed" : undefined);
  const blocked = items.some(({ id, product }) => reasonOf(id, product.orderDeadline));
  const { subtotal, unpriced } = summarize(toOrderLines(lines, products));

  // Each step starts at its heading, so a screen reader hears where it is and Tab starts at the top.
  const go = (next: Step) => {
    setStep(next);
    requestAnimationFrame(() => titleRef.current?.focus());
  };
  const forget = (id: string) =>
    setRejected((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });

  // D20: success and failure both open WhatsApp in this tab, after the result step has rendered.
  useEffect(() => {
    if (outcome) location.href = outcome.url;
  }, [outcome]);

  const title = step === "result" && outcome ? (outcome.orderNumber ? "Terima kasih!" : "Kirim pesanan") : TITLES[step === "form" ? "form" : "cart"];
  const showResult = step === "result" && outcome;

  return (
    <Dialog
      open={cartOpen}
      onClose={() => {
        closeCart();
        // Reopening starts at the cart: emptied after a saved order, unchanged after a failed one.
        setStep("cart");
        setOutcome(null);
        setItemsInvalid(false);
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
        <h2 id={titleId} ref={titleRef} className={styles.title} tabIndex={-1}>
          {title}
        </h2>
        <p className={styles.steps}>
          {step === "cart" ? (
            <>
              <b>1 Keranjang</b> → 2 Data pemesan
            </>
          ) : (
            <>
              1 Keranjang → <b>2 Data pemesan</b>
            </>
          )}
        </p>
      </div>

      {showResult ? (
        <OrderResult outcome={outcome} onDone={closeCart} />
      ) : items.length === 0 ? (
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
      ) : step === "form" ? (
        <CheckoutForm
          items={items}
          today={today}
          values={values}
          onChange={setValues}
          onBack={() => go("cart")}
          onRejected={(bad) => {
            setRejected(new Map(bad.map((line) => [line.productId, line.reason])));
            go("cart");
          }}
          onItemsInvalid={() => {
            setItemsInvalid(true);
            go("cart");
          }}
          onOutcome={(result) => {
            if (result.orderNumber) clearCart();
            setOutcome(result);
            setStep("result");
          }}
        />
      ) : (
        <>
          <div className={styles.body}>
            {blocked && (
              <p className={styles.alert} role="alert">
                Ada produk yang sudah tidak bisa dipesan. Hapus dulu untuk melanjutkan.
              </p>
            )}
            {itemsInvalid && !blocked && (
              <p className={styles.alert} role="alert">
                Keranjang tidak valid. Muat ulang halaman lalu coba lagi.
              </p>
            )}
            <ul className={styles.list} role="list">
              {items.map(({ id, qty, product }) => {
                const reason = reasonOf(id, product.orderDeadline);
                return (
                  <li key={id} className={styles.line}>
                    <span className={reason ? `${styles.thumb} ${styles.dim}` : styles.thumb}>
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
                        onClick={() => {
                          forget(id);
                          removeFromCart(id);
                        }}
                      >
                        Hapus
                      </button>
                    </div>
                    <div className={styles.right}>
                      <span className={styles.total}>{product.price === null ? "—" : formatRupiah(product.price * qty)}</span>
                      {reason ? (
                        <span className={styles.reason}>{REASONS[reason]}</span>
                      ) : (
                        <QuantityStepper
                          value={qty}
                          min={0}
                          max={MAX_QTY}
                          onChange={(q) => {
                            if (q < 1) forget(id);
                            setLineQty(id, q);
                          }}
                          name={product.name}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
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
            <div className={styles.next}>
              <Button
                size="md"
                block
                arrow
                disabled={blocked}
                onClick={() => {
                  setItemsInvalid(false);
                  go("form");
                }}
              >
                Lanjut isi data
              </Button>
            </div>
          </div>
        </>
      )}
    </Dialog>
  );
}
