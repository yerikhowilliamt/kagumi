import Link from "next/link";
import Button from "@/components/Button";
import LinkPending from "@/components/LinkPending";
import ProductThumb from "@/components/ProductThumb";
import Tag from "@/components/Tag";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateMedium, formatDateShort, formatRupiah, jakartaToday } from "@/lib/order";
import { listProducts, parseProductFilter, productCounts, type ProductFilter } from "@/lib/products";
// The chips, table, cards and empty line are the orders list's (design.md §7 Toolbar, Tables): one set of rules.
import list from "../pesanan/page.module.css";
import ActiveSwitch from "./ActiveSwitch";
import styles from "./page.module.css";

const CHIPS: { filter: ProductFilter; label: string }[] = [
  { filter: null, label: "Semua" },
  { filter: "READY_STOCK", label: "Ready stock" },
  { filter: "PRE_ORDER", label: "Pre-order" },
  { filter: "HIDDEN", label: "Disembunyikan" },
];
// The placeholder fills until M3.5 shows the photos; the storefront's four tones, by position.
const TONES = ["butter", "pink", "sky", "mint"] as const;

type Row = Awaited<ReturnType<typeof listProducts>>[number];

const mediaMeta = ({ photos, videos }: Row) => (photos + videos === 0 ? "belum ada foto" : `${photos} foto, ${videos} video`);

function cardMeta(p: Row) {
  if (!p.isActive) return p.closed ? "Ditutup" : "";
  const deadline = p.orderDeadline && (p.closed ? "Ditutup" : `s/d ${formatDateShort(p.orderDeadline)}`);
  return [p.price === null ? "Harga via WA" : formatRupiah(p.price), deadline].filter(Boolean).join(" · ");
}

const EditIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </svg>
);

// FR22 (show/hide, display order), M3 plan D14: `/admin/produk?filter=HIDDEN`. The chips are a GET form and the
// links plain links; only the switch needs client JS. No pages: shortcut: every product on one page, add
// pagination when the list passes 50 rows (a bakery menu stays under a few dozen).
export default async function ProductsPage({ searchParams }: PageProps<"/admin/produk">) {
  await requireAdmin();
  const filter = parseProductFilter(await searchParams);
  const [products, counts] = await Promise.all([listProducts(db, filter, jakartaToday()), productCounts(db)]);
  const edit = (id: string) => `/admin/produk/${id}`;

  return (
    <main>
      <div className={styles.head}>
        <h1 className={styles.title}>Produk</h1>
        <Button href="/admin/produk/baru" size="nav">
          + Tambah produk
        </Button>
      </div>

      <div className={list.toolbar}>
        <form className={list.chips} role="group" aria-label="Filter produk" action="/admin/produk">
          {CHIPS.map(({ filter: value, label }) => (
            <button
              key={label}
              className={list.chip}
              name={value ? "filter" : undefined}
              value={value ?? undefined}
              aria-pressed={filter === value}
            >
              {label} <em>{counts[value ?? "all"]}</em>
            </button>
          ))}
        </form>
      </div>

      {products.length === 0 ? (
        <p className={list.empty}>{counts.all === 0 ? "Belum ada produk." : "Tidak ada produk di filter ini."}</p>
      ) : (
        <>
          <div className={list.panel}>
            <table className={`${list.table} ${styles.table}`}>
              <thead>
                <tr>
                  <th>Produk</th>
                  <th>Tipe</th>
                  <th className={list.num}>Harga</th>
                  <th>Batas order</th>
                  <th>Tampil</th>
                  <th>
                    <span className={styles.hiddenText}>Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr key={p.id}>
                    <td>
                      <div className={styles.product}>
                        <span className={styles.thumb}>
                          <ProductThumb product={{ tone: TONES[i % TONES.length] }} />
                        </span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            {p.category} · {mediaMeta(p)}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td>{p.isActive ? <Tag type={p.type} detail /> : <Tag hidden />}</td>
                    <td className={`${list.num} ${p.price === null ? list.muted : ""}`}>{p.price === null ? "—" : formatRupiah(p.price)}</td>
                    <td className={p.orderDeadline ? undefined : list.muted}>
                      {!p.orderDeadline ? (
                        "—"
                      ) : p.closed ? (
                        <span className={styles.closed}>Ditutup {formatDateMedium(p.orderDeadline)}</span>
                      ) : (
                        formatDateMedium(p.orderDeadline)
                      )}
                    </td>
                    <td>
                      {/* Keyed by the saved state: a render after a change elsewhere starts the switch anew. */}
                      <ActiveSwitch key={String(p.isActive)} productId={p.id} name={p.name} active={p.isActive} />
                    </td>
                    <td className={list.num}>
                      <Link className={styles.edit} href={edit(p.id)} aria-label={`Edit ${p.name}`}>
                        <LinkPending />
                        <EditIcon />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Below 760px: each card is a link to the edit page, without a switch (D14 Narrow). */}
          <ul className={list.cards}>
            {products.map((p, i) => (
              <li key={p.id}>
                <Link className={list.card} href={edit(p.id)}>
                  <LinkPending />
                  <span className={styles.cardThumb}>
                    <ProductThumb product={{ tone: TONES[i % TONES.length] }} />
                  </span>
                  <span className={list.info}>
                    <strong>{p.name}</strong>
                    <span className={`${list.meta} ${styles.cardMeta}`}>
                      {p.isActive ? <Tag type={p.type} detail /> : <Tag hidden />}
                      {cardMeta(p)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
