"use client";

import { useRef, useState, type FormEvent } from "react";
import { createOrder } from "@/app/(store)/actions";
import type { CreateOrderResult } from "@/lib/checkout";
import type { CartLine } from "@/lib/cart";
import type { StoreProduct } from "@/lib/menu";
import { buildOrderMessage, formatRupiah, SHOP_WHATSAPP, summarize, whatsappUrl } from "@/lib/order";
import { checkoutSchema, type CheckoutInput } from "@/lib/validation";
import Button from "./Button";
import sheet from "./CartSheet.module.css";
import type { OrderOutcome } from "./OrderResult";
import Field from "./Field";
import SegmentedControl from "./SegmentedControl";
import styles from "./CheckoutForm.module.css";

export type CheckoutValues = Omit<CheckoutInput, "items" | "address" | "note"> & { address: string; note: string };

/** Always a fulfillment choice: with none, the schema reports only that field (BSA-M1.6-03, task note 8). */
export const EMPTY_VALUES: CheckoutValues = {
  customerName: "",
  customerPhone: "",
  fulfillment: "PICKUP",
  address: "",
  requestedDate: "",
  note: "",
};

type Fields = Partial<Record<keyof CheckoutInput, string>>;

// Form order, for moving focus to the first invalid field (design.md §8).
const ORDER = ["customerName", "customerPhone", "address", "requestedDate", "note"] as const;

const textOf = (waUrl: string) => decodeURIComponent(waUrl.slice(waUrl.indexOf("?text=") + 6));

// design.md §6 Cart sheet, step 2 (FR11). The values live in the sheet, so going back to the cart keeps them.
export default function CheckoutForm({
  items,
  today,
  values,
  onChange,
  onBack,
  onRejected,
  onItemsInvalid,
  onOutcome,
}: {
  items: (CartLine & { product: StoreProduct })[];
  /** The WIB date in the browser. */
  today: string;
  values: CheckoutValues;
  onChange: (values: CheckoutValues) => void;
  onBack: () => void;
  onRejected: (lines: Extract<CreateOrderResult, { error: "rejected" }>["lines"]) => void;
  onItemsInvalid: () => void;
  onOutcome: (outcome: OrderOutcome) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // A ref as well as state: a second click can land before the disabled button renders (K3).
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Fields>({});
  const [rateLimited, setRateLimited] = useState(false);
  const set = (patch: Partial<CheckoutValues>) => onChange({ ...values, ...patch });

  const orderLines = items.map(({ qty, product }) => ({ name: product.name, unitPrice: product.price, quantity: qty }));
  const { subtotal, unpriced } = summarize(orderLines);

  const showErrors = (fields: Fields) => {
    setErrors(fields);
    if (fields.items) return onItemsInvalid();
    const first = ORDER.find((name) => fields[name]);
    const control = first && formRef.current?.elements.namedItem(first);
    if (control instanceof HTMLElement) control.focus();
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pendingRef.current) return;
    const input = {
      ...values,
      address: values.fulfillment === "DELIVERY" ? values.address : undefined,
      items: items.map(({ id, qty }) => ({ productId: id, quantity: qty })),
    };
    const parsed = checkoutSchema(today).safeParse(input);
    if (!parsed.success) {
      const fields: Fields = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof CheckoutInput;
        fields[key] ??= issue.message;
      }
      return showErrors(fields);
    }
    setErrors({});
    setRateLimited(false);
    pendingRef.current = true;
    setPending(true);
    // One path for a thrown request and a "server" result (task note 5, D2).
    const result = await createOrder(input).catch((): CreateOrderResult => ({ ok: false, error: "server" }));
    pendingRef.current = false;
    setPending(false);
    if (result.ok) return onOutcome({ orderNumber: result.orderNumber, message: textOf(result.waUrl), url: result.waUrl });
    switch (result.error) {
      case "validation":
        return showErrors(result.fields);
      case "rate_limited":
        return setRateLimited(true);
      case "rejected":
        return onRejected(result.lines);
      case "server": {
        // FR14: the order is not saved, the message is still sent (no order number, D1 fallback).
        const message = buildOrderMessage({ lines: orderLines, customer: parsed.data });
        return onOutcome({ orderNumber: null, message, url: whatsappUrl(message) });
      }
    }
  }

  return (
    <>
      <form ref={formRef} id="checkout-form" className={sheet.body} noValidate onSubmit={submit}>
        {rateLimited && (
          <p className={styles.alert} role="alert">
            Terlalu banyak percobaan. Coba lagi beberapa menit lagi, atau{" "}
            <a href={`https://wa.me/${SHOP_WHATSAPP}`}>chat kami langsung di WhatsApp</a>.
          </p>
        )}
        {/* Placeholders, helpers and the privacy line are preview draft copy (D10). */}
        <Field
          label="Nama"
          name="customerName"
          autoComplete="name"
          placeholder="Nama kamu"
          value={values.customerName}
          onChange={(e) => set({ customerName: e.target.value })}
          error={errors.customerName}
        />
        <Field
          label="Nomor WhatsApp"
          name="customerPhone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="08xx-xxxx-xxxx"
          helper="Supaya kami bisa menghubungi kamu soal pesanan ini."
          value={values.customerPhone}
          onChange={(e) => set({ customerPhone: e.target.value })}
          error={errors.customerPhone}
        />
        <div className={styles.group}>
          <span className={styles.label} aria-hidden="true">
            Pengambilan
          </span>
          <SegmentedControl
            label="Pengambilan"
            value={values.fulfillment}
            onChange={(fulfillment) => set({ fulfillment })}
            options={[
              { value: "PICKUP", label: "Ambil sendiri", sub: "di Surakarta" },
              { value: "DELIVERY", label: "Diantar", sub: "area Solo, ongkir via chat" },
            ]}
          />
          {errors.fulfillment && <span className={styles.error}>{errors.fulfillment}</span>}
        </div>
        {values.fulfillment === "DELIVERY" && (
          <Field
            multiline
            label="Alamat"
            name="address"
            autoComplete="street-address"
            placeholder="Jalan, nomor, kelurahan, kecamatan"
            value={values.address}
            onChange={(e) => set({ address: e.target.value })}
            error={errors.address}
          />
        )}
        <Field
          label="Tanggal diminta"
          name="requestedDate"
          type="date"
          min={today}
          helper="Untuk pre-order, pesanan harus masuk sebelum batas order produknya."
          value={values.requestedDate}
          onChange={(e) => set({ requestedDate: e.target.value })}
          error={errors.requestedDate}
        />
        <Field
          multiline
          label={
            <>
              Catatan <small className={styles.optional}>(opsional)</small>
            </>
          }
          name="note"
          placeholder="Contoh: tulisan di kartu, jam ambil"
          value={values.note}
          onChange={(e) => set({ note: e.target.value })}
          error={errors.note}
        />
        <div className={styles.summary} aria-label="Ringkasan pesanan" role="group">
          {items.map(({ id, qty, product }) => (
            <p key={id} className={styles.row}>
              <span>
                {qty}× {product.name}
              </span>
              <span className={styles.num}>{product.price === null ? "via WA" : formatRupiah(product.price * qty)}</span>
            </p>
          ))}
          <p className={`${styles.row} ${styles.total}`}>
            <span>Subtotal</span>
            <span className={styles.num}>{unpriced < items.length ? formatRupiah(subtotal) + (unpriced ? " +" : "") : "—"}</span>
          </p>
        </div>
      </form>
      <div className={sheet.foot}>
        <Button variant="whatsapp" size="md" block type="submit" form="checkout-form" disabled={pending}>
          {pending ? "Mengirim…" : "Kirim pesanan via WhatsApp"}
        </Button>
        <p className={styles.privacy}>Data kamu hanya dipakai untuk memproses pesanan ini.</p>
        <p className={styles.back}>
          <Button variant="text" onClick={onBack}>
            ← Kembali ke keranjang
          </Button>
        </p>
      </div>
    </>
  );
}
