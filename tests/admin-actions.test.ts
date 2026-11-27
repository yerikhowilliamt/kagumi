import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// M2 plan D4, D12 (the gate test, exit criterion 2), D11 (login's server error), D14 (the e2e global setup).
// next/headers is mocked with a request that has no live session (no cookie, or a token the database doesn't know),
// and @/lib/db with a stub that records every property read: a protected export must redirect to /admin/login and
// read at most the session lookup.

const cookieStore = { get: vi.fn((): { value: string } | undefined => undefined), set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
  headers: async () => new Headers({ "user-agent": "kagumi-gate-test" }),
}));

const dbReads: string[] = [];
let dbRead: (prop: string) => unknown = () => undefined;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, prop) {
        dbReads.push(String(prop));
        return dbRead(String(prop));
      },
    },
  ),
}));

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const PUBLIC_ACTIONS = ["createOrder", "login"];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : walk(path);
    return /\.[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

const sources = walk(SRC).map((path) => ({ path, rel: relative(ROOT, path), text: readFileSync(path, "utf8") }));
// The directive as the first statement: only comments and whitespace may precede it.
const FIRST_STATEMENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["'];?/;
const actionFiles = sources.filter((s) => FIRST_STATEMENT.test(s.text));
// Every file Next renders as part of a route (BSA-M2.2-03): only the login page may sit outside (protected).
const ROUTE_FILE = /\/(page|layout|template|default)\.[jt]sx?$/;
const adminRoutes = sources.filter((s) => s.rel.startsWith("src/app/admin/") && ROUTE_FILE.test(s.rel));
const protectedRoutes = adminRoutes.filter((s) => s.rel.startsWith("src/app/admin/(protected)/"));
const routeHandlers = sources.filter((s) => /src\/app\/(admin|api)\/(.*\/)?route\.[jt]sx?$/.test(s.rel));

// Two ways to have no session (BSA-M2.2-04): a cookie-presence check passes the first but not the second.
const NO_SESSION = [
  { name: "no cookie", cookie: undefined, reads: [] as string[] },
  { name: "a token with no session row", cookie: { value: randomBytes(32).toString("base64url") }, reads: ["session"] },
];

function stubNoSession(mode: (typeof NO_SESSION)[number]) {
  cookieStore.get.mockImplementation(() => mode.cookie);
  dbRead = (prop) => (prop === "session" ? { findUnique: async () => null } : undefined);
}

/** The path of a Next redirect error (digest `NEXT_REDIRECT;<type>;<path>;<status>;`), or the error itself. */
async function redirectOf(run: () => unknown): Promise<string> {
  try {
    await run();
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return digest.split(";")[2];
    throw error;
  }
  throw new Error("returned without redirecting");
}

beforeEach(() => {
  dbReads.length = 0;
  dbRead = () => undefined;
  cookieStore.get.mockReset();
  cookieStore.set.mockClear();
  cookieStore.delete.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("admin gate (D4, D12)", () => {
  it("only the login page sits outside (protected) (BSA-M2.2-03)", () => {
    expect(adminRoutes.filter((s) => !protectedRoutes.includes(s)).map((s) => s.rel)).toEqual(["src/app/admin/login/page.tsx"]);
  });

  it("finds the action files, the protected pages and layouts", () => {
    expect(actionFiles.map((s) => s.rel).sort()).toEqual(expect.arrayContaining(["src/app/(store)/actions.ts", "src/app/admin/actions.ts"]));
    expect(protectedRoutes.map((s) => s.rel).sort()).toEqual(
      expect.arrayContaining([
        "src/app/admin/(protected)/layout.tsx",
        "src/app/admin/(protected)/page.tsx",
        "src/app/admin/(protected)/pesanan/page.tsx",
        // M3.2 K5: the new and edit product pages enter the page test below by path.
        "src/app/admin/(protected)/produk/baru/page.tsx",
        "src/app/admin/(protected)/produk/[id]/page.tsx",
      ]),
    );
  });

  it("has no inline \"use server\" (only as the first statement of a file)", () => {
    const inline = sources.filter((s) => {
      const count = s.text.match(/["']use server["']/g)?.length ?? 0;
      return count > (FIRST_STATEMENT.test(s.text) ? 1 : 0);
    });
    expect(inline.map((s) => s.rel)).toEqual([]);
  });

  it("every allow-listed public action still exists", async () => {
    const names = (await Promise.all(actionFiles.map((s) => import(s.path)))).flatMap((m) => Object.keys(m));
    for (const name of PUBLIC_ACTIONS) expect(names).toContain(name);
  });

  it("src/app/admin/actions.ts exports only login and logout (D23)", async () => {
    expect(Object.keys(await import("@/app/admin/actions")).sort()).toEqual(["login", "logout"]);
  });

  describe.each(NO_SESSION)("with $name", (mode) => {
    it("every other Server Action redirects to /admin/login and reads at most the session lookup", async () => {
      const called: string[] = [];
      for (const file of actionFiles) {
        const mod: Record<string, unknown> = await import(file.path);
        for (const [name, fn] of Object.entries(mod)) {
          if (PUBLIC_ACTIONS.includes(name)) continue;
          expect(typeof fn, `${file.rel} ${name}`).toBe("function");
          stubNoSession(mode);
          dbReads.length = 0;
          await expect(redirectOf(() => (fn as (...args: unknown[]) => unknown)(null, new FormData())), `${file.rel} ${name}`).resolves.toBe(
            "/admin/login",
          );
          expect(dbReads, `${file.rel} ${name}`).toEqual(mode.reads);
          called.push(name);
        }
      }
      expect(called).toContain("logout");
      // Each admin action by name, in the task that adds it (M3 plan D19).
      expect(called).toContain("setProductActive");
      expect(called).toContain("createProduct");
      expect(called).toContain("updateProduct");
      expect(called).toContain("deleteProduct");
      // M3.4: getUploadSignature is exit criterion 5.
      for (const name of ["getUploadSignature", "addProductMedia", "setMainMedia", "moveMedia", "deleteMedia"]) expect(called).toContain(name);
    });

    // Exit criterion 5 (M3.4 K5): with the Cloudinary variables set, no session still gets no signature: the action
    // redirects before it signs, and reads at most the session lookup.
    it("getUploadSignature redirects to /admin/login without signing", async () => {
      vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "test-cloud");
      vi.stubEnv("CLOUDINARY_API_KEY", "test-key");
      vi.stubEnv("CLOUDINARY_API_SECRET", "test-secret-not-real");
      const cloudinary = await import("@/lib/cloudinary");
      const sign = vi.spyOn(cloudinary, "signParams");
      const { getUploadSignature } = await import("@/app/admin/(protected)/produk/actions");
      stubNoSession(mode);
      let returned: unknown = "nothing";
      await expect(redirectOf(async () => (returned = await getUploadSignature()))).resolves.toBe("/admin/login");
      expect(returned).toBe("nothing");
      expect(sign).not.toHaveBeenCalled();
      expect(dbReads).toEqual(mode.reads);
    });

    // The default export and every function Next calls per request for the route (TR-M2.2-01).
    it("every protected page, layout, template and default (and its generateMetadata / generateViewport) redirects to /admin/login and reads at most the session lookup", async () => {
      const called: string[] = [];
      for (const file of protectedRoutes) {
        const mod: Record<string, unknown> = await import(file.path);
        for (const name of ["default", "generateMetadata", "generateViewport"]) {
          const fn = mod[name];
          if (typeof fn !== "function") continue;
          stubNoSession(mode);
          dbReads.length = 0;
          const props = { params: Promise.resolve({}), searchParams: Promise.resolve({}), children: null };
          await expect(redirectOf(() => (fn as (props: unknown, parent?: unknown) => unknown)(props, Promise.resolve({}))), `${file.rel} ${name}`).resolves.toBe(
            "/admin/login",
          );
          expect(dbReads, `${file.rel} ${name}`).toEqual(mode.reads);
          called.push(`${file.rel} ${name}`);
        }
      }
      expect(called).toContain("src/app/admin/(protected)/layout.tsx default");
      expect(called).toContain("src/app/admin/(protected)/produk/baru/page.tsx default");
      expect(called).toContain("src/app/admin/(protected)/produk/[id]/page.tsx default");
    });

    it("every admin and API route handler redirects to /admin/login (none exist in M2)", async () => {
      for (const file of routeHandlers) {
        const mod: Record<string, unknown> = await import(file.path);
        for (const [name, fn] of Object.entries(mod)) {
          if (typeof fn !== "function") continue;
          stubNoSession(mode);
          dbReads.length = 0;
          const request = new Request("http://localhost/", { method: name });
          await expect(redirectOf(() => (fn as (r: Request) => unknown)(request)), `${file.rel} ${name}`).resolves.toBe("/admin/login");
          expect(dbReads, `${file.rel} ${name}`).toEqual(mode.reads);
        }
      }
      expect(routeHandlers.map((s) => s.rel)).toEqual([]);
    });
  });
});

describe("login (D11)", () => {
  const EMAIL = "pemilik.rahasia@kagumi.test";
  const PASSWORD = "sandi-yang-sangat-rahasia-42";
  const form = () => {
    const data = new FormData();
    data.set("email", EMAIL);
    data.set("password", PASSWORD);
    return data;
  };

  it("returns server when the database throws, logs only the error name and code, and sets no cookie (K7)", async () => {
    dbRead = () => () => {
      throw Object.assign(new Error(`connection failed for ${EMAIL} / ${PASSWORD}`), { name: "PrismaClientKnownRequestError", code: "P1001" });
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { login } = await import("@/app/admin/actions");
    await expect(login(null, form())).resolves.toEqual({ error: "server" });
    expect(dbReads).toContain("$queryRaw");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual(["[login] failed", "PrismaClientKnownRequestError", "P1001"]);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(PASSWORD);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("returns invalid for a missing field before any database read", async () => {
    const { login } = await import("@/app/admin/actions");
    await expect(login(null, new FormData())).resolves.toEqual({ error: "invalid" });
    expect(dbReads).toEqual([]);
  });

  it("the page shows the D20 text for each state (K3, K7)", async () => {
    const { LOGIN_ALERTS } = await import("@/app/admin/login/LoginForm");
    expect(LOGIN_ALERTS).toEqual({
      invalid: "Email atau password salah.",
      server: "Sedang ada gangguan. Coba lagi sebentar lagi.",
    });
  });
});

describe("e2e global setup (D14, K8)", () => {
  it("returns before loading .env when PLAYWRIGHT_BASE_URL is set", async () => {
    vi.stubEnv("PLAYWRIGHT_BASE_URL", "https://kagumi-dough.vercel.app");
    const loadEnvFile = vi.spyOn(process, "loadEnvFile").mockImplementation(() => {});
    const { default: globalSetup } = await import("../e2e/global-setup.ts");
    await expect(globalSetup()).resolves.toBeUndefined();
    expect(loadEnvFile).not.toHaveBeenCalled();
    expect(dbReads).toEqual([]);
  });

  // BSA-M2.2-01: the write path. Each module is replaced so the order of loading .env, the host guard and the
  // database import is recorded; nothing reaches a database.
  async function runSetup(guard: () => void) {
    const order: string[] = [];
    const resets: { email: string; password: string }[] = [];
    const deletes: unknown[] = [];
    const txOptions: unknown[] = [];
    vi.stubEnv("PLAYWRIGHT_BASE_URL", "");
    vi.spyOn(process, "loadEnvFile").mockImplementation(() => void order.push("load"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("../prisma/seed.ts", () => ({ assertDevelopmentDatabase: () => (order.push("assert"), guard()) }));
    vi.doMock("../scripts/create-admin.ts", () => ({
      resetAdmin: async (_tx: unknown, input: { email: string; password: string }) => void resets.push(input),
    }));
    vi.doMock("../src/lib/db.ts", () => {
      order.push("db");
      return {
        db: {
          $transaction: (run: (tx: unknown) => unknown, options?: unknown) => (txOptions.push(options), run({ tx: true })),
          // One leftover with a medium, one without (M3.3: the delete path of D4).
          product: { findMany: async (args: unknown) => (order.push("find products"), deletes.push(args), [{ id: "p1" }, { id: "p2" }]) },
        },
      };
    });
    vi.doMock("../src/lib/products.ts", () => ({
      deleteProductRow: async (tx: unknown, id: string) => (deletes.push(["deleteProductRow", tx, id]), id === "p1" ? [{ publicId: "kagumi/dev/products/x", kind: "IMAGE" }] : []),
      processDeletions: async (client: unknown, assets: unknown, destroy: (publicId: string, kind: string) => unknown) => {
        deletes.push(["processDeletions", assets]);
        await destroy("kagumi/dev/products/x", "IMAGE");
        return 0;
      },
    }));
    vi.doMock("../src/lib/cloudinary.ts", () => ({ destroyAsset: async (...args: unknown[]) => void deletes.push(["destroyAsset", ...args]) }));
    const { default: globalSetup } = await import("../e2e/global-setup.ts");
    const { ADMIN_ACCOUNTS, passwordVar } = await import("../e2e/admin.ts");
    const outcome = await globalSetup().then(
      () => "resolved",
      () => "rejected",
    );
    const passwords = Object.keys(ADMIN_ACCOUNTS).map((account) => process.env[passwordVar(account as keyof typeof ADMIN_ACCOUNTS)]);
    for (const account of Object.keys(ADMIN_ACCOUNTS)) delete process.env[passwordVar(account as keyof typeof ADMIN_ACCOUNTS)];
    vi.doUnmock("../prisma/seed.ts");
    vi.doUnmock("../scripts/create-admin.ts");
    vi.doUnmock("../src/lib/db.ts");
    vi.doUnmock("../src/lib/products.ts");
    vi.doUnmock("../src/lib/cloudinary.ts");
    vi.resetModules();
    return { outcome, order, resets, deletes, txOptions, passwords, ADMIN_ACCOUNTS, printed: [...log.mock.calls, ...error.mock.calls] };
  }

  it("without it: loads .env, checks the development host before importing db, resets every account, deletes leftover E2E products (M3 D24), prints nothing", async () => {
    const run = await runSetup(() => {});
    expect(run.outcome).toBe("resolved");
    expect(run.order).toEqual(["load", "assert", "db", "find products"]);
    // Each leftover E2E product goes through the delete transaction; only queued media reach the real destroy.
    expect(run.deletes).toEqual([
      { where: { name: { startsWith: "E2E " } }, select: { id: true } },
      ["deleteProductRow", { tx: true }, "p1"],
      ["processDeletions", [{ publicId: "kagumi/dev/products/x", kind: "IMAGE" }]],
      ["destroyAsset", "kagumi/dev/products/x", "IMAGE"],
      ["deleteProductRow", { tx: true }, "p2"],
    ]);
    expect(run.resets.map((r) => r.email)).toEqual(Object.values(run.ADMIN_ACCOUNTS));
    const passwords = run.resets.map((r) => r.password);
    for (const password of passwords) expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(new Set(passwords).size).toBe(Object.keys(run.ADMIN_ACCOUNTS).length);
    expect(Object.keys(run.ADMIN_ACCOUNTS)).toContain("products");
    expect(run.passwords).toEqual(passwords);
    expect(run.printed).toEqual([]);
    // M5.1 K4 (TD-007): every transaction, the account resets included, waits up to 10 s for a connection.
    expect(run.txOptions).toEqual(Array(Object.keys(run.ADMIN_ACCOUNTS).length + 2).fill({ maxWait: 10_000 }));
  });

  it("resets nothing and never imports db when the host guard throws", async () => {
    const run = await runSetup(() => {
      throw new Error("DATABASE_URL is not the development branch named in DEV_DATABASE_HOST; refusing to run");
    });
    expect(run.outcome).toBe("rejected");
    expect(run.order).toEqual(["load", "assert"]);
    expect(run.resets).toEqual([]);
    expect(run.deletes).toEqual([]);
  });
});
