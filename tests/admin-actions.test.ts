import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// M2 plan D4, D12 (the gate test, exit criterion 2), D11 (login's server error), D14 (the e2e global setup).
// next/headers is mocked with a request that has no session cookie, and @/lib/db with a stub that records
// every property read: a protected export must redirect to /admin/login before it touches the database.

const cookieStore = { get: vi.fn(() => undefined), set: vi.fn(), delete: vi.fn() };
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
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const sources = walk(SRC).map((path) => ({ path, rel: relative(ROOT, path), text: readFileSync(path, "utf8") }));
// The directive as the first statement: only comments and whitespace may precede it.
const FIRST_STATEMENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["'];?/;
const actionFiles = sources.filter((s) => FIRST_STATEMENT.test(s.text));
const protectedRoutes = sources.filter((s) => /src\/app\/admin\/\(protected\)\/(.*\/)?(page|layout)\.tsx$/.test(s.rel));
const routeHandlers = sources.filter((s) => /src\/app\/(admin|api)\/(.*\/)?route\.(ts|tsx)$/.test(s.rel));

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
  cookieStore.get.mockClear();
  cookieStore.set.mockClear();
  cookieStore.delete.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("admin gate (D4, D12)", () => {
  it("finds the action files, the protected pages and layouts", () => {
    expect(actionFiles.map((s) => s.rel).sort()).toEqual(expect.arrayContaining(["src/app/(store)/actions.ts", "src/app/admin/actions.ts"]));
    expect(protectedRoutes.map((s) => s.rel).sort()).toEqual(
      expect.arrayContaining([
        "src/app/admin/(protected)/layout.tsx",
        "src/app/admin/(protected)/page.tsx",
        "src/app/admin/(protected)/pesanan/page.tsx",
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

  it("every other Server Action redirects to /admin/login without a session and reads nothing from the database", async () => {
    const called: string[] = [];
    for (const file of actionFiles) {
      const mod: Record<string, unknown> = await import(file.path);
      for (const [name, fn] of Object.entries(mod)) {
        if (PUBLIC_ACTIONS.includes(name)) continue;
        expect(typeof fn, `${file.rel} ${name}`).toBe("function");
        dbReads.length = 0;
        await expect(redirectOf(() => (fn as (...args: unknown[]) => unknown)(null, new FormData())), `${file.rel} ${name}`).resolves.toBe(
          "/admin/login",
        );
        expect(dbReads, `${file.rel} ${name}`).toEqual([]);
        called.push(name);
      }
    }
    expect(called).toContain("logout");
  });

  it("every protected page and layout redirects to /admin/login without a session and reads nothing from the database", async () => {
    for (const file of protectedRoutes) {
      const Component = (await import(file.path)).default as (props: unknown) => unknown;
      dbReads.length = 0;
      const props = { params: Promise.resolve({}), searchParams: Promise.resolve({}), children: null };
      await expect(redirectOf(() => Component(props)), file.rel).resolves.toBe("/admin/login");
      expect(dbReads, file.rel).toEqual([]);
    }
  });

  it("every admin and API route handler redirects to /admin/login (none exist in M2)", async () => {
    for (const file of routeHandlers) {
      const mod: Record<string, unknown> = await import(file.path);
      for (const [name, fn] of Object.entries(mod)) {
        if (typeof fn !== "function") continue;
        dbReads.length = 0;
        const request = new Request("http://localhost/", { method: name });
        await expect(redirectOf(() => (fn as (r: Request) => unknown)(request)), `${file.rel} ${name}`).resolves.toBe("/admin/login");
        expect(dbReads, `${file.rel} ${name}`).toEqual([]);
      }
    }
    expect(routeHandlers.map((s) => s.rel)).toEqual([]);
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
});
