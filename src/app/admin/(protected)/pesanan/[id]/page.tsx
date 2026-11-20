import Link from "next/link";
import { notFound } from "next/navigation";
import Button from "@/components/Button";
import { STATUS_LABEL } from "@/components/OrderStatusBadge";
import ProductThumb from "@/components/ProductThumb";
import StatusPicker from "@/components/StatusPicker";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import type { StoreProduct } from "@/lib/menu";
import {
  chatGreeting,
  chatUrl,
  formatDateLong,
  formatOrderNumber,
  formatPhone,
  formatRupiah,
  formatWhen,
  itemTotals,
} from "@/lib/order";
import { getOrder, type OrderStatus } from "@/lib/orders";
import styles from "./page.module.css";

// Placeholder tones by line index (D18): no product lookup. Typed by menu.ts, so a tone it drops fails typecheck.
const TONES: StoreProduct["tone"][] = ["butter", "pink", "sky", "mint"];
// design.md §7 Activity feed rails: new order --link, completed --success, confirmed or cancelled --line.
const RAIL: Record<OrderStatus, string> = { NEW: styles.railNew, CONFIRMED: styles.railLine, COMPLETED: styles.railDone, CANCELLED: styles.railLine };

// FR29, System Design §4.9 Detail, M2 plan D18, D19.
export default async function OrderPage({ params }: PageProps<"/admin/pesanan/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const order = /^\d{1,9}$/.test(id) ? await getOrder(db, Number(id)) : null;
  if (!order) notFound();

  const number = formatOrderNumber(order.id);
  const now = new Date();
  const when = formatWhen(order.createdAt, now);
  const totals = itemTotals(order.items);
  const note = order.note?.trim();

  return (
    <main>
      <div className={styles.head}>
        <div>
          <p className={styles.crumb}>
            <Link href="/admin/pesanan">Pesanan</Link> / {number}
          </p>
          <h1 className={styles.title}>Pesanan {number}</h1>
          <p className={styles.muted}>
            Masuk {when[0].toLowerCase() + when.slice(1)} · dari website
          </p>
        </div>
        {/* A new tab keeps the order open (M2.5 plan O7). The URL names the order number, never the customer (D19). */}
        <Button variant="whatsapp" size="nav" href={chatUrl(order.customerPhone, chatGreeting(order.id))} target="_blank" rel="noopener noreferrer">
          Buka chat WhatsApp
        </Button>
      </div>

      <div className={styles.columns}>
        <section className={styles.panel} aria-labelledby="items">
          <div className={styles.panelHead}>
            <h2 id="items">Item pesanan</h2>
            <span>{totals.quantity} item</span>
          </div>
          <ul className={styles.lines}>
            {order.items.map((line, index) => (
              <li key={line.id}>
                <span className={styles.thumb}>
                  <ProductThumb product={{ tone: TONES[index % TONES.length] }} />
                </span>
                <span className={styles.lineName}>
                  <strong>{line.productName}</strong>
                  <small>
                    {line.unitPrice === null ? "Harga via WA" : formatRupiah(line.unitPrice)} × {line.quantity}
                  </small>
                </span>
                <span className={line.unitPrice === null ? styles.muted : undefined}>
                  {line.unitPrice === null ? "—" : formatRupiah(line.unitPrice * line.quantity)}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.total}>
            <span>Subtotal</span>
            <span>
              {totals.unpriced === totals.quantity ? "—" : formatRupiah(totals.subtotal)}
              {totals.unpriced > 0 && <small> + {totals.unpriced} item tanpa harga</small>}
            </span>
          </p>

          <div className={`${styles.panelHead} ${styles.spaced}`}>
            <h2>Data pembeli</h2>
          </div>
          <dl className={styles.dl}>
            <dt>Nama</dt>
            <dd>{order.customerName}</dd>
            <dt>WhatsApp</dt>
            <dd>{formatPhone(order.customerPhone)}</dd>
            <dt>Pengambilan</dt>
            <dd>{order.fulfillment === "DELIVERY" ? "Diantar" : "Ambil sendiri"}</dd>
            {order.fulfillment === "DELIVERY" && (
              <>
                <dt>Alamat</dt>
                <dd>{order.address}</dd>
              </>
            )}
            <dt>Tanggal diminta</dt>
            <dd>{formatDateLong(order.requestedDate)}</dd>
          </dl>
          {note && (
            <p className={styles.note}>
              <span className={styles.muted}>Catatan:</span> {note}
            </p>
          )}
        </section>

        <div className={styles.side}>
          <section className={styles.panel} aria-labelledby="status">
            <div className={styles.panelHead}>
              <h2 id="status">Status</h2>
            </div>
            <StatusPicker orderId={order.id} status={order.status} />
          </section>
          <section className={styles.panel} aria-labelledby="history">
            <div className={styles.panelHead}>
              <h2 id="history">Riwayat</h2>
            </div>
            <ol className={styles.feed}>
              {order.statusChanges.map((change) => (
                <li key={change.id} className={change.fromStatus === null ? styles.railNew : RAIL[change.toStatus]}>
                  <time dateTime={change.createdAt.toISOString()}>{formatWhen(change.createdAt, now)}</time>
                  <span>
                    <strong>{change.fromStatus === null ? "Pesanan masuk" : `Status diubah ke ${STATUS_LABEL[change.toStatus]}`}</strong>
                    <span>{change.fromStatus === null ? "Checkout dari website" : "oleh Admin"}</span>
                  </span>
                  <span className={styles.pill}>{STATUS_LABEL[change.toStatus]}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </main>
  );
}
