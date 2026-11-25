"use client";

import Image from "next/image";
import { useId, useState } from "react";
import { posterUrl, videoUrl } from "@/lib/media";
import { MAX_QTY, formatDateShort, formatRupiah, isClosed } from "@/lib/order";
import Button from "./Button";
import Dialog from "./Dialog";
import ProductThumb from "./ProductThumb";
import QuantityStepper from "./QuantityStepper";
import { useStore } from "./StoreProvider";
import Tag from "./Tag";
import styles from "./ProductDetail.module.css";

const MAIN_SIZES = "(max-width: 760px) 100vw, 480px";
const ROW_SIZES = "(max-width: 760px) 25vw, 120px";

// design.md §6 Product detail (FR6). Rendered once by the page; the store says which product it shows.
// Gallery (M3 plan D17): the main slot shows the selected medium, a video only on demand (no autoplay, no preload);
// the thumbnail row shows with two or more media; with none, the placeholder alone (M1-D9).
export default function ProductDetail() {
  const { selected: product, detailOpen, closeDetail, today, addToCart } = useStore();
  const titleId = useId();
  const [qty, setQty] = useState(1);
  const [selected, setSelected] = useState(0);
  // Every opening starts the stepper at 1 and the gallery at the first medium.
  const [wasOpen, setWasOpen] = useState(detailOpen);
  if (detailOpen !== wasOpen) {
    setWasOpen(detailOpen);
    if (detailOpen) {
      setQty(1);
      setSelected(0);
    }
  }

  if (!product) return null;
  const closed = isClosed(product.orderDeadline, today);
  const { media, tone } = product;
  const shown = media[selected] ?? media[0];

  return (
    <Dialog open={detailOpen} onClose={closeDetail} labelledBy={titleId}>
      <div className={styles.gallery}>
        <div className={styles.main}>
          {shown?.kind === "VIDEO" ? (
            <video key={shown.publicId} className={styles.video} src={videoUrl(shown)} poster={posterUrl(shown, 960)} controls playsInline preload="none" />
          ) : (
            <ProductThumb product={{ tone, media: shown ? [shown] : [] }} sizes={MAIN_SIZES} alt={product.name} />
          )}
        </div>
        {media.length > 1 && (
          <ul className={styles.row} role="list">
            {media.map((m, i) => (
              <li key={m.publicId}>
                {/* Preview draft labels (D18), owner review in M5. */}
                <button
                  type="button"
                  className={styles.pick}
                  aria-label={`${m.kind === "VIDEO" ? "Video" : "Foto"} ${i + 1}`}
                  aria-pressed={m === shown}
                  onClick={() => setSelected(i)}
                >
                  {m.kind === "VIDEO" ? (
                    <>
                      <Image className={styles.poster} loader={({ width }) => posterUrl(m, width)} src={m.publicId} alt="" fill sizes={ROW_SIZES} />
                      <span className={styles.play} aria-hidden="true">
                        ▶
                      </span>
                    </>
                  ) : (
                    <ProductThumb product={{ tone, media: [m] }} sizes={ROW_SIZES} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.info}>
        <Tag type={product.type} detail />
        <h2 id={titleId} className={styles.title}>
          {product.name}
        </h2>
        {product.price === null ? (
          <p className={`${styles.price} ${styles.ask}`}>Harga dikonfirmasi via WhatsApp</p>
        ) : (
          <p className={styles.price}>{formatRupiah(product.price)}</p>
        )}
        {product.description && <p className={styles.desc}>{product.description}</p>}
        {product.orderDeadline && (
          <p className={styles.deadline}>Batas order {formatDateShort(product.orderDeadline)}</p>
        )}
        {/* Preview draft copy (D10), owner review in M5. */}
        <ul className={styles.facts} role="list">
          <li>
            <span className={styles.factLabel}>Pengambilan:</span> ambil sendiri atau diantar (area Solo)
          </li>
          <li>
            <span className={styles.factLabel}>Dibuat:</span> fresh setelah pesanan dikonfirmasi
          </li>
        </ul>
        <div className={styles.buy}>
          {closed ? (
            <p className={styles.closed}>Order sudah ditutup</p>
          ) : (
            <>
              <QuantityStepper value={qty} min={1} max={MAX_QTY} onChange={setQty} name={product.name} size="lg" />
              <Button
                size="md"
                block
                onClick={() => {
                  addToCart(product.id, qty);
                  closeDetail();
                }}
              >
                Tambah ke keranjang
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
