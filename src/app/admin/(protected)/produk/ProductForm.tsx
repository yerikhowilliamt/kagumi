"use client";

import { unstable_rethrow } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Button from "@/components/Button";
import Field from "@/components/Field";
import SegmentedControl from "@/components/SegmentedControl";
import Switch from "@/components/Switch";
import { formatRupiah } from "@/lib/order";
import type { ProductData, ProductField } from "@/lib/validation";
import detail from "../pesanan/[id]/page.module.css";
import { createProduct, updateProduct, type ProductFormState } from "./actions";
import styles from "./form.module.css";

export type ProductValues = Omit<ProductData, "isActive"> & { id?: string; isActive: boolean };

const TYPES = [
  { value: "PRE_ORDER", label: "Pre-order" },
  { value: "READY_STOCK", label: "Ready stock" },
] as const;
// The fields with a message, in the form's order: focus goes to the first invalid one (design.md §5 Inputs).
const ORDER: ProductField[] = ["name", "category", "price", "description", "orderDeadline", "sortOrder"];

// design.md §7 Product form, Informasi produk panel and the sticky action bar; M3 plan D12, D13. No client checks: the
// server's messages are the only rule set (task note 4). Submitted from onSubmit, not the form's action prop, so React
// never resets the typed values (K3). `children` is the right-hand panel.
export default function ProductForm({ product, categories, children }: { product: ProductValues; categories: string[]; children?: ReactNode }) {
  const editing = product.id !== undefined;
  // attempt keys the alert, so a repeated failure is announced again (as LoginForm).
  const [state, dispatch, pending] = useActionState(
    async (prev: { result: ProductFormState; attempt: number } | null, form: FormData) => {
      let result: ProductFormState;
      try {
        result = await (editing ? updateProduct : createProduct)(null, form);
      } catch (error) {
        unstable_rethrow(error); // the redirect after a create, or to the login when the session expired
        result = { ok: false, error: "server" }; // no answer: offline, or dropped on the way
      }
      return { result, attempt: (prev?.attempt ?? 0) + 1 };
    },
    null,
  );
  const [type, setType] = useState(product.type);
  const [active, setActive] = useState(product.isActive);
  const form = useRef<HTMLFormElement>(null);

  const result = state?.result;
  const fields = result && !result.ok && "fields" in result ? result.fields : {};
  const failed = result && !result.ok && !ORDER.some((name) => fields[name]);

  useEffect(() => {
    const fields = state?.result && !state.result.ok && "fields" in state.result ? state.result.fields : {};
    const first = ORDER.find((name) => fields[name]);
    if (first) (form.current?.elements.namedItem(first) as HTMLElement | null)?.focus();
  }, [state]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  };

  return (
    <form ref={form} className={styles.form} onSubmit={submit} noValidate>
      <section className={detail.panel} aria-labelledby="info">
        <div className={detail.panelHead}>
          <h2 id="info">Informasi produk</h2>
        </div>
        {editing && <input type="hidden" name="id" value={product.id} />}
        <Field admin label="Nama produk" name="name" defaultValue={product.name} error={fields.name} />
        <div className={styles.row2}>
          <Field
            admin
            label="Kategori"
            name="category"
            list="product-categories"
            defaultValue={product.category}
            helper="Pilih yang ada atau ketik kategori baru."
            error={fields.category}
          />
          <datalist id="product-categories">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
          <Field
            admin
            label={
              <>
                Harga <small className={styles.optional}>(opsional)</small>
              </>
            }
            prefix="Rp"
            name="price"
            inputMode="numeric"
            defaultValue={product.price === null ? "" : formatRupiah(product.price).slice(2)}
            helper="Kosongkan untuk tampil 'Harga via WA'"
            error={fields.price}
          />
        </div>
        <Field admin multiline label="Deskripsi" name="description" defaultValue={product.description} error={fields.description} />
        <div className={styles.row2}>
          <div className={styles.group}>
            <span className={styles.label}>Tipe</span>
            <input type="hidden" name="type" value={type} />
            <SegmentedControl admin label="Tipe produk" options={[...TYPES]} value={type} onChange={setType} />
          </div>
          <Field
            admin
            label={
              <>
                Batas order <small className={styles.optional}>(opsional)</small>
              </>
            }
            name="orderDeadline"
            type="date"
            defaultValue={product.orderDeadline ?? ""}
            helper="Setelah tanggal ini, tombol pesan otomatis mati."
            error={fields.orderDeadline}
          />
        </div>
        <div className={styles.row2}>
          <div className={styles.group}>
            <span className={styles.label}>Tampilkan di website</span>
            <input type="hidden" name="isActive" value={String(active)} />
            <span>
              <Switch checked={active} onChange={setActive} label="Tampil" aria-label="Tampilkan di website" />
            </span>
          </div>
          <Field
            admin
            label="Urutan tampil"
            name="sortOrder"
            type="number"
            inputMode="numeric"
            min={0}
            max={9999}
            defaultValue={product.sortOrder}
            helper="Angka kecil tampil lebih dulu"
            error={fields.sortOrder}
          />
        </div>
      </section>

      {children}

      <div className={styles.actions}>
        {failed && (
          <p key={state?.attempt} className={styles.alert} role="alert">
            Perubahan belum tersimpan. Coba lagi.
          </p>
        )}
        <p className={styles.saved} role="status">
          {result?.ok && !pending ? "Tersimpan." : ""}
        </p>
        <Button variant="line" size="nav" href="/admin/produk">
          Batal
        </Button>
        <Button type="submit" size="nav" aria-busy={pending || undefined}>
          {pending ? "Menyimpan…" : editing ? "Simpan perubahan" : "Simpan produk"}
        </Button>
      </div>
    </form>
  );
}
