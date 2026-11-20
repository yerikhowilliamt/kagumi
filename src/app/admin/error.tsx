"use client";

import Button from "@/components/Button";
import styles from "./error.module.css";

// A failed render of any admin page, or of the (protected) layout itself (the database is down in requireAdmin), so
// it draws no admin shell. The error is not shown: its message could quote order data.
export default function AdminError({ retry }: { retry: () => void }) {
  return (
    <main className={styles.error}>
      <h1 className={styles.title}>Halaman gagal dimuat</h1>
      <Button variant="line" size="nav" onClick={retry}>
        Coba lagi
      </Button>
    </main>
  );
}
