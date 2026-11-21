import Link from "next/link";
import LinkPending from "@/components/LinkPending";
import styles from "./not-found.module.css";

// The 404 of every admin page that calls notFound(), inside the admin shell. Next 16 still delivers it as an error
// shell rendered in the browser (dev and production), so the <head> theme script does not run: ThemeToggle applies
// the stored theme instead (see its comment and the 404 test in e2e/admin-order-detail.spec.ts).
export default function AdminNotFound() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Halaman tidak ditemukan</h1>
      <p className={styles.text}>Pesanan atau halaman ini tidak ada.</p>
      <Link className={styles.link} href="/admin/pesanan">
        <LinkPending />
        ← Kembali ke pesanan
      </Link>
    </main>
  );
}
