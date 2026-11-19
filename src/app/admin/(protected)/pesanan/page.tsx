import { requireAdmin } from "@/lib/auth";

// The orders page head; M2.4 adds the list.
export default async function OrdersPage() {
  await requireAdmin();
  return (
    <main>
      <p>Pesanan</p>
      <h1>Pesanan dari website</h1>
    </main>
  );
}
