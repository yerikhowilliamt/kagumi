// Password hashing (task M2.1 K2, K9), written from System Design §4.4 and the M2 plan D10, D13, D23.
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashPassword, normalizeEmail, verifyDummy, verifyPassword } from "@/lib/password";

const root = join(import.meta.dirname, "..");
const FORMAT = /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/;

describe("hashPassword (D10)", () => {
  it("returns scrypt$16384$8$1$ + 32 hex salt + $ + 128 hex key", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(FORMAT);
    expect(stored).toHaveLength(178);
  });

  it("gives two different hashes for one password (random salt)", async () => {
    expect(await hashPassword("same password!")).not.toBe(await hashPassword("same password!"));
  });
});

describe("verifyPassword (D10)", () => {
  it("is true for the right password and false for a wrong one", async () => {
    const stored = await hashPassword("right password 1");
    expect(await verifyPassword("right password 1", stored)).toBe(true);
    expect(await verifyPassword("right password 2", stored)).toBe(false);
  });

  it("is false, without throwing, for malformed stored strings", async () => {
    const good = await hashPassword("pw-123456789012");
    const [, n, r, p, salt, key] = good.split("$");
    const malformed = [
      `bcrypt$${n}$${r}$${p}$${salt}$${key}`, // wrong prefix
      `scrypt$${n}$${r}$${p}$${key}`, // missing part
      `scrypt$${n}$${r}$${p}$${salt}`,
      `scrypt$${n}$${r}$${p}$${salt.replace(/^./, "z")}$${key}`, // non-hex salt
      `scrypt$${n}$${r}$${p}$${salt}$${key.replace(/^./, "g")}`, // non-hex key
      `scrypt$${n}$${r}$${p}$${salt}$${key.slice(0, 126)}`, // key of 63 bytes
      `scrypt$${n}$${r}$${p}$${salt}$${key}00`, // key of 65 bytes
      `scrypt$${n}$${r}$${p}$${salt}$${key.toUpperCase()}`,
      `scrypt$1000$${r}$${p}$${salt}$${key}`, // N not a power of two: scrypt itself refuses
      `scrypt$99999999999999999999$${r}$${p}$${salt}$${key}`,
      "",
    ];
    for (const stored of malformed) {
      await expect(verifyPassword("pw-123456789012", stored), stored).resolves.toBe(false);
    }
  });

  it("reads N, r and p from the stored string (a hash with N = 1024 verifies)", async () => {
    const salt = randomBytes(16);
    const key = scryptSync("low cost password", salt, 64, { N: 1024, r: 8, p: 1 });
    const stored = `scrypt$1024$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
    expect(await verifyPassword("low cost password", stored)).toBe(true);
    expect(await verifyPassword("low cost passwore", stored)).toBe(false);
  });
});

describe("verifyDummy and normalizeEmail", () => {
  it("verifyDummy is always false", async () => {
    expect(await verifyDummy("anything")).toBe(false);
    expect(await verifyDummy("")).toBe(false);
  });

  it("normalizeEmail trims and lowercases", () => {
    expect(normalizeEmail("  Admin@X.Test \n")).toBe("admin@x.test");
  });
});

describe("import boundaries (K9, D23; K8 guard order)", () => {
  const imports = (file: string) =>
    [...readFileSync(join(root, file), "utf8").matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)].map(
      ([, spec]) => spec,
    );

  it("src/lib/password.ts imports only node:crypto", () => {
    expect(new Set(imports("src/lib/password.ts"))).toEqual(new Set(["node:crypto"]));
  });

  it("scripts/create-admin.ts has no @/ import", () => {
    const specs = imports("scripts/create-admin.ts");
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.filter((s) => s.startsWith("@/"))).toEqual([]);
  });

  it("scripts/create-admin.ts calls assertDevelopmentDatabase() before importing src/lib/db.ts, and only dynamically", () => {
    const source = readFileSync(join(root, "scripts/create-admin.ts"), "utf8");
    expect(source).not.toMatch(/from\s*["'][^"']*lib\/db(\.ts)?["']/);
    const guard = source.indexOf("assertDevelopmentDatabase();");
    const load = source.indexOf('await import("../src/lib/db.ts")');
    expect(guard).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(guard);
  });
});
