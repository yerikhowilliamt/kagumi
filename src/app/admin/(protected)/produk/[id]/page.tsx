import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import LinkPending from "@/components/LinkPending";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { categories, getProduct } from "@/lib/products";
import detail from "../../pesanan/[id]/page.module.css";
import ProductForm from "../ProductForm";

// FR22 edit (M3 plan D12, D13). The media panel comes in M3.4, "Hapus produk" in M3.3.
export default async function EditProductPage({ params }: PageProps<"/admin/produk/[id]">) {
  await requireAdmin();
  const { id } = await params;
  // Anything but a UUID is a 404 without a query: Postgres would throw on it (a 500), also on a UUID-shaped string
  // like 36 dashes, so the shape regex of the task entry is not enough.
  const [product, suggestions] = z.uuid().safeParse(id).success ? await Promise.all([getProduct(db, id), categories(db)]) : [null, []];
  if (!product) notFound();
  return (
    <main>
      <div className={detail.head}>
        <div>
          <p className={detail.crumb}>
            <Link href="/admin/produk">
              <LinkPending />
              Produk
            </Link>{" "}
            / Edit
          </p>
          <h1 className={detail.title}>{product.name}</h1>
        </div>
      </div>
      {/* Not keyed by the row: a save re-renders this page, and the form must keep its "Tersimpan." line. */}
      <ProductForm product={product} categories={suggestions} />
    </main>
  );
}
