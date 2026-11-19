import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

// The overview arrives in M4; until then /admin opens the orders.
export default async function AdminHome() {
  await requireAdmin();
  redirect("/admin/pesanan");
}
