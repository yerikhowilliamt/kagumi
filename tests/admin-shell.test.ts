// The admin shell rendered with its session, database and counts replaced: no network (BSA-M2.3-01, -03).
// Proves what the layout wires together: the WIB date for the counts and the WIB render time (M2 plan D17),
// and the NEW pill in the sidebar only, hidden at 0 (D17, H3), without writing an order (H4).
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProtectedLayout from "@/app/admin/(protected)/layout";
import layoutStyles from "@/app/admin/(protected)/layout.module.css";
import navStyles from "@/components/AdminNav.module.css";
import { db } from "@/lib/db";
import { statusBarCounts } from "@/lib/orders";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/orders", () => ({ statusBarCounts: vi.fn() }));
vi.mock("@/app/admin/actions", () => ({ logout: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/pesanan" }));

const counts = vi.mocked(statusBarCounts);
const text = (html: string) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

async function render(newOrders: number, openPreOrders: number) {
  counts.mockResolvedValue({ newOrders, openPreOrders });
  const html = renderToStaticMarkup(await ProtectedLayout({ children: null }));
  const status = new RegExp(`<p class="${layoutStyles.live}">(.*?)</p>`).exec(html)?.[1] ?? "";
  const navs = Object.fromEntries(
    [...html.matchAll(/<nav class="([^"]*)"[^>]*>(.*?)<\/nav>/g)].map(([, cls, inner]) => [cls, inner]),
  );
  return { status: text(status), side: navs[navStyles.side] ?? "", bottom: navs[navStyles.bottom] ?? "" };
}

const pill = (nav: string) => new RegExp(`<span class="${navStyles.count}">(\\d+)</span>`).exec(nav)?.[1];

describe("admin shell layout", () => {
  beforeEach(() => {
    counts.mockReset();
    // 00:30 WIB on 20 November while UTC is still 19 November.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T17:30:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("counts for the WIB date and shows the WIB render time (K3, D17)", async () => {
    const { status } = await render(3, 2);
    expect(counts).toHaveBeenCalledExactlyOnceWith(db, "2026-11-20");
    expect(status).toBe("3 pesanan baru · 2 PO aktif · Diperbarui 00.30");
  });

  it("shows the NEW count pill in the sidebar only (K1, D17, H3)", async () => {
    const { side, bottom } = await render(7, 0);
    expect(side).toContain("Pesanan");
    expect(pill(side)).toBe("7");
    expect(bottom).toContain("Pesanan");
    expect(pill(bottom)).toBeUndefined();
  });

  it("hides the pill when there are no NEW orders (K1, D17)", async () => {
    const { side, status } = await render(0, 0);
    expect(status).toBe("0 pesanan baru · 0 PO aktif · Diperbarui 00.30");
    expect(side).toContain("Pesanan");
    expect(pill(side)).toBeUndefined();
  });
});
