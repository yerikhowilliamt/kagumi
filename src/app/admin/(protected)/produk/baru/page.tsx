import Link from "next/link";
import LinkPending from "@/components/LinkPending";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { categories, nextSortOrder } from "@/lib/products";
import detail from "../../pesanan/[id]/page.module.css";
import styles from "../form.module.css";
import ProductForm from "../ProductForm";

// FR22 add (M3 plan D2, D12): pre-order, shown, sorted last. Photos and videos come after the first save, on the
// edit page (D2).
export default async function NewProductPage() {
  await requireAdmin();
  const [suggestions, sortOrder] = await Promise.all([categories(db), nextSortOrder(db)]);
  return (
    <main>
      <div className={detail.head}>
        <div>
          <p className={detail.crumb}>
            <Link href="/admin/produk">
              <LinkPending />
              Produk
            </Link>{" "}
            / Tambah
          </p>
          <h1 className={detail.title}>Tambah produk</h1>
        </div>
      </div>
      <ProductForm
        product={{ name: "", category: "", description: "", price: null, type: "PRE_ORDER", orderDeadline: null, isActive: true, sortOrder }}
        categories={suggestions}
      >
        <section className={detail.panel} aria-labelledby="media">
          <div className={detail.panelHead}>
            <h2 id="media">Foto & video</h2>
          </div>
          <p className={styles.notice}>Simpan informasi produk dulu, lalu tambahkan foto dan video.</p>
        </section>
      </ProductForm>
    </main>
  );
}
