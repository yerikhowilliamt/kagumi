import Link from "next/link";
import LinkPending from "@/components/LinkPending";
import styles from "./not-found.module.css";

// The 404 of every admin page that calls notFound(), rendered on the server inside the admin shell. Without this
// file Next sent an error shell and rendered the tree in the browser, where the root theme script never runs.
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
