import Image from "next/image";
import ThemeToggle from "@/components/ThemeToggle";
import styles from "./page.module.css";

export default function Home() {
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
    </main>
  );
}
