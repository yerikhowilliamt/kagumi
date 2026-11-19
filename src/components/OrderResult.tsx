import Button from "./Button";
import sheet from "./CartSheet.module.css";
import styles from "./OrderResult.module.css";

/** What the checkout ended with: saved (FR13) or not saved (FR14, no order number). */
export type OrderOutcome = { orderNumber: string | null; message: string; url: string };

// design.md §6 Cart sheet, step 3: "Selesai" and "Order not saved". The page navigates to `url` itself (D20).
export default function OrderResult({ outcome, onDone }: { outcome: OrderOutcome; onDone: () => void }) {
  const saved = outcome.orderNumber !== null;
  return (
    <>
      <div className={sheet.body}>
        <div className={styles.done}>
          <span className={`${styles.burst} ${saved ? styles.ok : styles.fail}`} aria-hidden="true">
            {saved ? "✓" : "!"}
          </span>
          <h3 className={styles.title}>{saved ? "Pesanan tersimpan!" : "Pesanan belum tercatat di sistem kami"}</h3>
          {saved ? (
            <p className={styles.text}>
              {/* Preview draft copy (D10). */}
              Nomor pesanan <b>{outcome.orderNumber}</b>. WhatsApp akan terbuka dengan pesan di bawah, tinggal tekan kirim.
            </p>
          ) : (
            <p className={styles.text}>Pesananmu tetap bisa dikirim. Tekan tombol di bawah untuk mengirimnya lewat WhatsApp.</p>
          )}
          <p className={styles.bubble} data-testid="wa-bubble">
            {outcome.message}
          </p>
        </div>
      </div>
      <div className={sheet.foot}>
        <Button variant="whatsapp" size="md" block href={outcome.url}>
          {saved ? "Buka WhatsApp lagi" : "Kirim via WhatsApp"}
        </Button>
        <p className={styles.back}>
          <Button variant="text" onClick={onDone}>
            Kembali ke menu
          </Button>
        </p>
      </div>
    </>
  );
}
