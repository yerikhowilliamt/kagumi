import type { Metadata } from "next";
import type { ReactNode } from "react";
import Button from "@/components/Button";
import { requireAdmin } from "@/lib/auth";
import { logout } from "../actions";

// M2 plan D21.
export const metadata: Metadata = { title: "Admin · Kagumi Dough", robots: { index: false, follow: false } };

// The boundary for every admin page (D4). Layouts don't re-render on client navigation, so every page calls
// requireAdmin() too (FR21). The shell replaces this wrapper in M2.3.
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <>
      <form action={logout}>
        <Button type="submit" variant="line" size="nav">
          Keluar
        </Button>
      </form>
      {children}
    </>
  );
}
