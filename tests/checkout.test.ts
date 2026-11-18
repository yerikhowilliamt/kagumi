// Server failure without a database (D11, task M1.6 K8, K10). Written from the D2 contract.
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkout } from "@/lib/checkout";
import { visitorHash } from "@/lib/tracking";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "kagumi-test" }),
}));
const transaction = vi.fn();
vi.mock("@/lib/db", () => ({ db: { $transaction: (...args: unknown[]) => transaction(...args) } }));

const CUSTOMER = {
  customerName: "Rina Unik Sekali",
  customerPhone: "0812-9876-5432",
  fulfillment: "DELIVERY",
  address: "Jl. Rahasia Nomor 77",
  requestedDate: "2026-11-25",
  note: "Catatan pribadi pelanggan",
  items: [{ productId: "019a8f3e-7c2b-7abc-8def-000000000001", quantity: 1 }],
};
const PRIVATE = ["Rina Unik Sekali", "0812-9876-5432", "6281298765432", "Jl. Rahasia Nomor 77", "Catatan pribadi pelanggan"];
const CTX = { ip: "203.0.113.7", ua: "kagumi-test", secret: "test-secret", now: new Date("2026-11-20T03:00:00Z") };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  transaction.mockReset();
});

function expectNoCustomerData(spy: { mock: { calls: unknown[][] } }) {
  const logged = spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
  for (const value of PRIVATE) expect(logged).not.toContain(value);
}

describe("checkout maps any throw to the server result (D2, D11)", () => {
  it("a client whose $transaction rejects gives { ok: false, error: 'server' } and logs no input (K8)", async () => {
    const error = Object.assign(new Error(`connect failed for ${CUSTOMER.customerName}`), { code: "P1001" });
    const client = { $transaction: vi.fn().mockRejectedValue(error) };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(checkout(client as never, CUSTOMER, CTX)).resolves.toEqual({ ok: false, error: "server" });
    expect(client.$transaction).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0].map(String)).toContain("P1001");
    expectNoCustomerData(spy);
  });

  it("a throw inside the transaction callback gives server too", async () => {
    const client = { $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}) }; // tx without methods: placeOrder throws
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(checkout(client as never, CUSTOMER, CTX)).resolves.toEqual({ ok: false, error: "server" });
    expectNoCustomerData(spy);
  });

  it("a missing TRACKING_SECRET gives server and never opens a transaction", async () => {
    const client = { $transaction: vi.fn() };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(checkout(client as never, CUSTOMER, { ...CTX, secret: undefined })).resolves.toEqual({ ok: false, error: "server" });
    expect(client.$transaction).not.toHaveBeenCalled();
    expectNoCustomerData(spy);
  });
});

describe("src/app/(store)/actions.ts (D17)", () => {
  it("exports only createOrder (K10)", async () => {
    const actions = await import("@/app/(store)/actions");
    expect(Object.keys(actions)).toEqual(["createOrder"]);
  });

  it("createOrder without TRACKING_SECRET returns server", async () => {
    vi.stubEnv("TRACKING_SECRET", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { createOrder } = await import("@/app/(store)/actions");
    await expect(createOrder(CUSTOMER)).resolves.toEqual({ ok: false, error: "server" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("createOrder rate-limits by the visitor of the request's x-forwarded-for and user-agent (BSA-M1.6-01)", async () => {
    vi.stubEnv("TRACKING_SECRET", "test-secret");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T03:00:00Z"));
    try {
      // The tx stub records the rate-limit statement's values, then stops the checkout.
      const values: unknown[][] = [];
      const tx = {
        $queryRaw: (_sql: TemplateStringsArray, ...args: unknown[]) => {
          values.push(args);
          throw new Error("stop here");
        },
      };
      transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { createOrder } = await import("@/app/(store)/actions");
      await expect(createOrder(CUSTOMER)).resolves.toEqual({ ok: false, error: "server" });
      // headers() above: x-forwarded-for 203.0.113.7, user-agent kagumi-test.
      const expected = visitorHash({ ip: "203.0.113.7", ua: "kagumi-test", now: new Date(), secret: "test-secret" });
      expect(values[0][0]).toBe(`checkout:${expected}`);
      expect(values[0][0]).not.toBe(`checkout:${visitorHash({ ip: "", ua: "", now: new Date(), secret: "test-secret" })}`);
    } finally {
      vi.useRealTimers();
    }
  });
});
