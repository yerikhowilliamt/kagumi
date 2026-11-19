import Link from "next/link";
import OrderStatusBadge, { STATUS_LABEL } from "@/components/OrderStatusBadge";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateMedium, formatDateShort, formatOrderNumber, formatSubtotal, formatWhen } from "@/lib/order";
import { ORDER_STATUSES, listOrders, orderListHref, parseOrderQuery, statusCounts } from "@/lib/orders";
import styles from "./page.module.css";

const FULFILLMENT = { DELIVERY: "Diantar", PICKUP: "Ambil" } as const;
const CHIPS = [{ status: null, label: "Semua" }, ...ORDER_STATUSES.map((status) => ({ status, label: STATUS_LABEL[status] }))];

// FR28, FR30, System Design §4.9 List, M2 plan D5 and D16. Every control is a GET form or a link: no client JS.
export default async function OrdersPage({ searchParams }: PageProps<"/admin/pesanan">) {
  await requireAdmin();
  const query = parseOrderQuery(await searchParams);
  const [list, counts] = await Promise.all([listOrders(db, query), statusCounts(db)]);
  const now = new Date();
  const detail = (id: number) => `/admin/pesanan/${id}`;

  return (
    <main>
      <div className={styles.head}>
        <p className={styles.label}>Pesanan</p>
        <h1 className={styles.title}>Pesanan dari website</h1>
      </div>

      <div className={styles.toolbar}>
        {/* Chips are toggle buttons (design.md §8 aria-pressed) in a GET form that keeps the search. */}
        <form className={styles.chips} role="group" aria-label="Filter status" action="/admin/pesanan">
          {query.q && <input type="hidden" name="q" value={query.q} />}
          {CHIPS.map(({ status, label }) => (
            <button
              key={label}
              className={styles.chip}
              name={status ? "status" : undefined}
              value={status ?? undefined}
              aria-pressed={query.status === status}
            >
              {label} <em>{counts[status ?? "all"]}</em>
            </button>
          ))}
        </form>
        {/* Submitted with Enter; keeps the status filter (D16). */}
        <form className={styles.search} role="search" action="/admin/pesanan">
          {query.status && <input type="hidden" name="status" value={query.status} />}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            maxLength={80}
            aria-label="Cari pesanan"
            placeholder="Cari nama atau no. pesanan"
          />
        </form>
      </div>

      {list.total === 0 ? (
        // "Belum ada pesanan." is seen only on an empty database: production in M5 (R11).
        <p className={styles.empty}>{counts.all === 0 ? "Belum ada pesanan." : "Tidak ada pesanan yang cocok."}</p>
      ) : (
        <>
          <div className={styles.panel}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Masuk</th>
                  <th>Pembeli</th>
                  <th>Ambil/Antar</th>
                  <th>Tanggal diminta</th>
                  <th className={styles.num}>Item</th>
                  <th className={styles.num}>Subtotal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((order) => (
                  <tr key={order.id}>
                    <td>
                      {/* Its ::after covers the row, so the whole row is one link and one Tab stop. */}
                      <Link className={styles.rowLink} href={detail(order.id)}>
                        {formatOrderNumber(order.id)}
                      </Link>
                    </td>
                    <td className={styles.muted}>{formatWhen(order.createdAt, now)}</td>
                    <td>{order.customerName}</td>
                    <td>{FULFILLMENT[order.fulfillment]}</td>
                    <td>{formatDateMedium(order.requestedDate)}</td>
                    <td className={styles.num}>{order.quantity}</td>
                    <td className={styles.num}>{formatSubtotal(order)}</td>
                    <td>
                      <OrderStatusBadge status={order.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className={styles.cards}>
            {list.rows.map((order) => (
              <li key={order.id}>
                <Link className={styles.card} href={detail(order.id)}>
                  <span className={styles.info}>
                    <strong>{order.customerName}</strong>
                    <span className={styles.meta}>
                      {[
                        formatOrderNumber(order.id),
                        FULFILLMENT[order.fulfillment],
                        formatDateShort(order.requestedDate),
                        formatSubtotal(order),
                      ]
                        .filter((part) => part !== "—")
                        .join(" · ")}
                    </span>
                  </span>
                  <OrderStatusBadge status={order.status} />
                </Link>
              </li>
            ))}
          </ul>

          {list.pageCount > 1 && (
            <nav className={styles.pages} aria-label="Halaman pesanan">
              {list.page > 1 ? (
                <Link href={orderListHref({ ...query, page: list.page - 1 })}>← Sebelumnya</Link>
              ) : (
                <span />
              )}
              <span className={styles.muted}>
                Halaman {list.page} dari {list.pageCount}
              </span>
              {list.page < list.pageCount ? (
                <Link href={orderListHref({ ...query, page: list.page + 1 })}>Berikutnya →</Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
