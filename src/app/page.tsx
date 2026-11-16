import Image from "next/image";
import ThemeToggle from "@/components/ThemeToggle";
import { db } from "@/lib/db";
import styles from "./page.module.css";

// P16: request-time query shows which Neon branch a deployment reads. M1 replaces this page with the static storefront.
export const dynamic = "force-dynamic";

export default async function Home() {
  const activeProducts = await db.product.count({ where: { isActive: true } });
  return (
    <main className={styles.page}>
      <div className={styles.toggle}>
        <ThemeToggle />
      </div>
      <Image className={styles.logo} src="/images/logo.jpg" alt="Logo Kagumi Dough" width={112} height={112} priority />
      <p className={styles.eyebrow}>
        <span className={styles.marker} aria-hidden="true" />
        Segera hadir
      </p>
      <h1 className={styles.title}>Kagumi Dough</h1>
      <p className={styles.lead}>Kue rumahan dari Solo, dibuat sesuai pesanan.</p>
      <p className={styles.lead}>{`Produk aktif: ${activeProducts}`}</p>
    </main>
  );
}
