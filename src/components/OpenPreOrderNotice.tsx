"use client";

import { hasOpenPreOrder } from "@/lib/menu";
import { useStore } from "./StoreProvider";

// The key phrase of the notice bar, in front of the delivery text, while a pre-order is open (design.md §6 Notice bar).
export default function OpenPreOrderNotice() {
  const { products, today } = useStore();
  if (!hasOpenPreOrder(products, today)) return null;
  return (
    <>
      <strong>Open pre-order</strong>
      {" · "}
    </>
  );
}
