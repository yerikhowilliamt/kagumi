import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import { getAdmin } from "@/lib/auth";
import LoginForm from "./LoginForm";
import styles from "./page.module.css";

// M2 plan D21.
export const metadata: Metadata = { title: "Admin · Kagumi Dough", robots: { index: false, follow: false } };

// design.md §7 Login. No `next` parameter, so there is no open redirect (D11).
export default async function LoginPage() {
  if (await getAdmin()) redirect("/admin");
  return (
    <main className={styles.login}>
      <div className={styles.toggle}>
        <ThemeToggle />
      </div>
      <div className={styles.card}>
        <Image className={styles.logo} src="/images/logo.jpg" alt="Kagumi Dough" width={64} height={64} priority />
        <p className={styles.label}>Admin</p>
        <h1 className={styles.title}>Masuk ke dashboard</h1>
        <p className={styles.subtitle}>Kelola menu, pesanan, dan statistik toko.</p>
        <LoginForm />
        <p className={styles.foot}>Lupa password? Hubungi pengelola website.</p>
      </div>
    </main>
  );
}
