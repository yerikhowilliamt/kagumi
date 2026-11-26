// The order list page's pagination links (BSA-M2.4-03; M2.4 K2, M2 plan D5, D16 Pages row). The page is called as a
// function and its element tree read (no DOM, M1-D6). Its database is a transaction that is always rolled back, with
// explicit ids, so orders_id_seq does not move (W5).
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { assertDevelopmentDatabase } from "../../prisma/seed.ts";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set: tests/db needs the development branch in .env");
}
assertDevelopmentDatabase();

const state = vi.hoisted(() => ({ tx: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ adminId: "test", sessionId: "test" }) }));
// While a test runs, the page's `db` is that test's transaction.
vi.mock("@/lib/db", async (importOriginal) => {
  const real = (await importOriginal<typeof import("@/lib/db")>()).db;
  return {
    db: new Proxy(real, {
      get(target, prop) {
        const client = (state.tx ?? target) as typeof real;
        const value = Reflect.get(client, prop);
        return typeof value === "function" ? value.bind(client) : value;
      },
    }),
  };
});

const { db } = await import("@/lib/db");
const { default: OrdersPage } = await import("@/app/admin/(protected)/pesanan/page");
type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
const ROLLBACK = new Error("rollback");

async function rolledBack(fn: (tx: Tx) => Promise<void>) {
  await expect(
    db.$transaction(
      async (tx) => {
        state.tx = tx;
        try {
          await fn(tx);
        } finally {
          state.tx = null;
        }
        throw ROLLBACK;
      },
      { maxWait: 10_000, timeout: 60_000 }, // ERR-003
    ),
  ).rejects.toBe(ROLLBACK);
}

/** Every element in the tree whose own children include `text`. */
function withText(node: ReactNode, text: string): { href?: string }[] {
  if (Array.isArray(node)) return node.flatMap((child) => withText(child, text));
  if (!isValidElement<{ children?: ReactNode; href?: string }>(node)) return [];
  const children = node.props.children;
  const own = (Array.isArray(children) ? children : [children]).some((child) => child === text);
  return [...(own ? [node.props] : []), ...withText(children, text)];
}

describe("the order list page's pagination (BSA-M2.4-03)", { timeout: 120_000 }, () => {
  it("'Berikutnya →' on page 1 and '← Sebelumnya' on page 2 keep status and q; one page shows neither", async () => {
    const tag = `Test M2.5 pages ${Date.now().toString(36)}`;
    await rolledBack(async (tx) => {
      // One statement, not 51: over a slow link those can pass the transaction timeout (ERR-005).
      await tx.order.createMany({
        data: Array.from({ length: 51 }, (_, i) => ({
          id: -1_500_000_000 - i,
          customerName: tag,
          customerPhone: "6280000000000",
          fulfillment: "PICKUP" as const,
          requestedDate: new Date("2026-11-25T00:00:00Z"),
          status: "CONFIRMED" as const,
        })),
      });
      const q = encodeURIComponent(tag).replace(/%20/g, "+");

      const first = await OrdersPage({ searchParams: Promise.resolve({ status: "CONFIRMED", q: tag }) } as never);
      expect(withText(first, "Berikutnya →").map((p) => p.href)).toEqual([`/admin/pesanan?status=CONFIRMED&q=${q}&page=2`]);
      expect(withText(first, "← Sebelumnya")).toEqual([]);

      const second = await OrdersPage({ searchParams: Promise.resolve({ status: "CONFIRMED", q: tag, page: "2" }) } as never);
      expect(withText(second, "← Sebelumnya").map((p) => p.href)).toEqual([`/admin/pesanan?status=CONFIRMED&q=${q}`]);
      expect(withText(second, "Berikutnya →")).toEqual([]);

      // Another status: nothing of this tag, one page, no pagination at all.
      const none = await OrdersPage({ searchParams: Promise.resolve({ status: "NEW", q: tag }) } as never);
      expect(withText(none, "Berikutnya →")).toEqual([]);
      expect(withText(none, "← Sebelumnya")).toEqual([]);
    });
  });
});
