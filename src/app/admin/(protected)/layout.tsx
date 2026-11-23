import type { Metadata } from "next";
import Image from "next/image";
import type { ReactNode } from "react";
import AdminNav from "@/components/AdminNav";
import ThemeToggle from "@/components/ThemeToggle";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJakartaTime, jakartaToday } from "@/lib/order";
import { statusBarCounts } from "@/lib/orders";
import { logout } from "../actions";
import styles from "./layout.module.css";

// M2 plan D21.
export const metadata: Metadata = { title: "Admin · Kagumi Dough", robots: { index: false, follow: false } };

const LogoutIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
    <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10" />
  </svg>
);

// The boundary for every admin page (D4). Layouts don't re-render on client navigation, so every page calls
// requireAdmin() too (FR21), and the counts can lag until the next full render (R9; "Diperbarui" says when).
// The shell is design.md §7: sidebar above 760px, top bar and bottom nav at 760px and below.
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  const now = new Date();
  const { newOrders, openPreOrders } = await statusBarCounts(db, jakartaToday(now));

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Image className={styles.logo} src="/images/logo.jpg" alt="" width={30} height={30} />
          Kagumi Admin
        </div>
        <div className={styles.actions}>
          <ThemeToggle />
          <form action={logout}>
            <button type="submit" className={styles.iconButton} aria-label="Keluar">
              <LogoutIcon />
            </button>
          </form>
        </div>
      </header>

      <aside className={styles.side}>
        <div className={styles.sideBrand}>
          <Image className={styles.logo} src="/images/logo.jpg" alt="" width={34} height={34} />
          <div>
            Kagumi Dough
            <small>Admin</small>
          </div>
        </div>
        <AdminNav variant="side" newOrders={newOrders} />
        <div className={styles.sideBottom}>
          <ThemeToggle label="Ganti tema" />
          <a className={styles.item} href="/" target="_blank" rel="noopener">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
              <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
            Lihat website
          </a>
          <form action={logout}>
            <button type="submit" className={styles.item}>
              <LogoutIcon />
              Keluar
            </button>
          </form>
        </div>
      </aside>

      {/* Before the content in the DOM, so at 760px and below Tab reaches it right after the top bar (TD-005). It is
          position: fixed there and hidden above, so nothing moves on screen. */}
      <div className={styles.bottomNav}>
        <AdminNav variant="bottom" newOrders={newOrders} />
      </div>

      <div className={styles.main}>
        <div className={styles.statusbar}>
          <p className={styles.live}>
            <b className={styles.dot} aria-hidden="true" />
            {newOrders} pesanan baru <span className={styles.sep}>·</span> {openPreOrders} PO aktif{" "}
            <span className={styles.sep}>·</span> <span className={styles.updated}>Diperbarui {formatJakartaTime(now)}</span>
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
