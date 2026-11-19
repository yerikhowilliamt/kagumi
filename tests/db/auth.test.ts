// Admin authentication against the development branch (task M2.1 K3–K7), written from System Design §4.4,
// ERD admin_users and sessions, and the M2 plan D8, D9, D11, D13. Every test runs in a transaction that is
// always rolled back, with `now` as a parameter. The one committed row (W2): the barrier test's fixture
// admin under a random test-…@kagumi.test email, deleted in afterAll (its sessions cascade).
import { spawnSync } from "node:child_process";
import { createHash, randomUUID, scrypt } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { assertDevelopmentDatabase } from "../../prisma/seed.ts";
import { resetAdmin } from "../../scripts/create-admin.ts";
import { attemptLogin, createSession, deleteSession, findSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";

// K4: count the real scrypt derivations. The wrapper calls node's scrypt unchanged.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt: vi.fn(actual.scrypt) };
});
const scryptCalls = vi.mocked(scrypt);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set: tests/db needs the development branch in .env");
}
assertDevelopmentDatabase();

const { db } = await import("@/lib/db");

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
const ROLLBACK = new Error("rollback");

/** Runs fn in a transaction that is always rolled back. */
async function rolledBack(fn: (tx: Tx) => Promise<void>) {
  await expect(
    db.$transaction(
      async (tx) => {
        await fn(tx);
        throw ROLLBACK;
      },
      { timeout: 30_000 },
    ),
  ).rejects.toBe(ROLLBACK);
}

const NOW = new Date("2026-11-20T03:00:00Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const RIGHT = "right password 123";
const WRONG = "wrong password 123";
const EMAIL = "admin@x.test";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function admin(tx: Tx, data: { email?: string; failedAttempts?: number; lockedUntil?: Date | null } = {}) {
  return tx.adminUser.create({
    data: { email: data.email ?? EMAIL, passwordHash: await hashPassword(RIGHT), failedAttempts: data.failedAttempts, lockedUntil: data.lockedUntil },
  });
}
const row = (tx: Tx, id: string) => tx.adminUser.findUniqueOrThrow({ where: { id } });
const login = (tx: Tx, password: string, now: Date, email = EMAIL) => attemptLogin(tx, { email, password, now });

describe("attemptLogin: lockout (K3, D9)", { timeout: 60_000 }, () => {
  it("four failures leave the account open; the fifth locks it for 15 minutes and resets the counter", async () => {
    await rolledBack(async (tx) => {
      const a = await admin(tx);
      for (let i = 1; i <= 4; i++) {
        expect(await login(tx, WRONG, NOW)).toEqual({ ok: false });
        expect(await row(tx, a.id)).toMatchObject({ failedAttempts: i, lockedUntil: null });
      }
      expect(await login(tx, WRONG, NOW)).toEqual({ ok: false });
      expect(await row(tx, a.id)).toMatchObject({ failedAttempts: 0, lockedUntil: at(15 * MIN) });
    });
  });

  it("after four failures the right password still logs in and resets the counter", async () => {
    await rolledBack(async (tx) => {
      const a = await admin(tx);
      for (let i = 0; i < 4; i++) await login(tx, WRONG, NOW);
      expect(await login(tx, RIGHT, NOW)).toEqual({ ok: true, adminId: a.id });
      expect(await row(tx, a.id)).toMatchObject({ failedAttempts: 0, lockedUntil: null });
    });
  });

  it("during the lock the right password fails and changes no column; at +15:00 exactly it succeeds", async () => {
    await rolledBack(async (tx) => {
      const a = await admin(tx);
      for (let i = 0; i < 5; i++) await login(tx, WRONG, NOW);
      const locked = await row(tx, a.id);

      expect(await login(tx, RIGHT, at(MIN))).toEqual({ ok: false });
      expect(await row(tx, a.id)).toEqual(locked);
      expect(await login(tx, WRONG, at(2 * MIN))).toEqual({ ok: false }); // not counted, lock not extended
      expect(await row(tx, a.id)).toEqual(locked);
      expect(await login(tx, RIGHT, at(15 * MIN - 1000))).toEqual({ ok: false }); // 14:59
      expect(await row(tx, a.id)).toEqual(locked);

      expect(await login(tx, RIGHT, at(15 * MIN))).toEqual({ ok: true, adminId: a.id });
      expect(await row(tx, a.id)).toMatchObject({ failedAttempts: 0, lockedUntil: null });
    });
  });

  it("a wrong attempt after the lock ended starts counting again from 0", async () => {
    await rolledBack(async (tx) => {
      const a = await admin(tx, { failedAttempts: 0, lockedUntil: NOW });
      expect(await login(tx, WRONG, NOW)).toEqual({ ok: false });
      expect(await row(tx, a.id)).toMatchObject({ failedAttempts: 1, lockedUntil: null });
    });
  });

  it("a success after three failures resets the counter", async () => {
    await rolledBack(async (tx) => {
      const a = await admin(tx);
      for (let i = 0; i < 3; i++) await login(tx, WRONG, NOW);
      expect(await row(tx, a.id)).toMatchObject({ failedAttempts: 3 });
      expect(await login(tx, RIGHT, NOW)).toEqual({ ok: true, adminId: a.id });
      expect(await row(tx, a.id)).toMatchObject({ failedAttempts: 0, lockedUntil: null });
    });
  });

  it('" Admin@X.test " matches the row admin@x.test', async () => {
    await rolledBack(async (tx) => {
      const a = await admin(tx);
      expect(await login(tx, RIGHT, NOW, " Admin@X.test ")).toEqual({ ok: true, adminId: a.id });
    });
  });

  it("an empty or oversized password fails before any query and changes nothing", async () => {
    await rolledBack(async (tx) => {
      const a = await admin(tx);
      const before = await row(tx, a.id);
      expect(await login(tx, "", NOW)).toEqual({ ok: false });
      expect(await login(tx, "x".repeat(1025), NOW)).toEqual({ ok: false });
      expect(await login(tx, RIGHT, NOW, "   ")).toEqual({ ok: false });
      expect(await row(tx, a.id)).toEqual(before);
      // 1024 characters is still an attempt: it is counted (TEC-M2.1-03).
      expect(await login(tx, "x".repeat(1024), NOW)).toEqual({ ok: false });
      expect(await row(tx, a.id)).toMatchObject({ failedAttempts: 1 });
    });
  });
});

describe("attemptLogin: one answer, one scrypt (K4, D9.3, D11)", { timeout: 60_000 }, () => {
  it("an unknown email and a wrong password return the same value; the unknown email changes no row", async () => {
    await rolledBack(async (tx) => {
      await admin(tx);
      const all = () => tx.adminUser.findMany({ orderBy: { id: "asc" } });
      const wrong = await login(tx, WRONG, NOW);
      const before = await all();
      const unknown = await login(tx, RIGHT, NOW, `nobody-${randomUUID()}@x.test`);
      expect(unknown).toStrictEqual(wrong);
      expect(unknown).toStrictEqual({ ok: false });
      expect(await all()).toEqual(before);
    });
  });

  it("right password, wrong password, unknown email and locked account each run exactly one scrypt", async () => {
    await rolledBack(async (tx) => {
      await admin(tx);
      await admin(tx, { email: "locked@x.test", lockedUntil: at(10 * MIN) });
      const cases = [
        ["right password", RIGHT, EMAIL],
        ["wrong password", WRONG, EMAIL],
        ["unknown email", RIGHT, `nobody-${randomUUID()}@x.test`],
        ["locked account", RIGHT, "locked@x.test"],
      ] as const;
      for (const [name, password, email] of cases) {
        scryptCalls.mockClear();
        await login(tx, password, NOW, email);
        expect(scryptCalls, name).toHaveBeenCalledTimes(1);
      }
    });
  });
});

describe("attemptLogin under concurrency (K5, D9.2)", { timeout: 60_000 }, () => {
  const email = `test-${randomUUID()}@kagumi.test`;
  afterAll(async () => {
    await db.adminUser.deleteMany({ where: { email } });
  });

  it("counts both reservations when B runs while A holds the row", async () => {
    await db.adminUser.create({ data: { email, passwordHash: await hashPassword(RIGHT), failedAttempts: 1 } });

    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => (releaseA = resolve));
    let signalA!: () => void;
    const aReserved = new Promise<void>((resolve) => (signalA = resolve));
    let signalB!: () => void;
    const bStarted = new Promise<void>((resolve) => (signalB = resolve));
    const backendPid = async (tx: Tx) => (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
    let pidA = 0;
    let pidB = 0;

    const a = db.$transaction(
      async (tx) => {
        pidA = await backendPid(tx);
        await attemptLogin(tx, { email, password: WRONG, now: new Date() });
        signalA();
        await gateA;
      },
      { timeout: 30_000 },
    );
    await aReserved;
    const b = db.$transaction(
      async (tx) => {
        pidB = await backendPid(tx);
        signalB();
        return attemptLogin(tx, { email, password: WRONG, now: new Date() });
      },
      { timeout: 30_000 },
    );

    // Barrier: B's backend is blocked by A's backend (the row lock) before A commits.
    await bStarted;
    let waiting = false;
    for (let i = 0; i < 200 && !waiting; i++) {
      const [{ blocked }] = await db.$queryRaw<{ blocked: boolean }[]>`
        SELECT ${pidA}::int = ANY(pg_blocking_pids(${pidB}::int)) AS blocked`;
      waiting = blocked;
    }
    releaseA();
    await a;
    await b;
    expect(waiting, "B never waited for A's lock").toBe(true);

    const after = await db.adminUser.findUniqueOrThrow({ where: { email } });
    expect(after.failedAttempts).toBe(3);
  });

  it("a sixth attempt that waits for the fifth's lock is refused, even with the right password (TEC-M2.1-01)", async () => {
    await db.adminUser.update({ where: { email }, data: { failedAttempts: 4, lockedUntil: null } });
    const now = new Date();

    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => (releaseA = resolve));
    let signalA!: () => void;
    const aReserved = new Promise<void>((resolve) => (signalA = resolve));
    let signalB!: () => void;
    const bStarted = new Promise<void>((resolve) => (signalB = resolve));
    const backendPid = async (tx: Tx) => (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
    let pidA = 0;
    let pidB = 0;

    const a = db.$transaction(
      async (tx) => {
        pidA = await backendPid(tx);
        const result = await attemptLogin(tx, { email, password: WRONG, now }); // the fifth failure: locks
        signalA();
        await gateA;
        return result;
      },
      { timeout: 30_000 },
    );
    await aReserved;
    const b = db.$transaction(
      async (tx) => {
        pidB = await backendPid(tx);
        signalB();
        return attemptLogin(tx, { email, password: RIGHT, now });
      },
      { timeout: 30_000 },
    );

    await bStarted;
    let waiting = false;
    for (let i = 0; i < 200 && !waiting; i++) {
      const [{ blocked }] = await db.$queryRaw<{ blocked: boolean }[]>`
        SELECT ${pidA}::int = ANY(pg_blocking_pids(${pidB}::int)) AS blocked`;
      waiting = blocked;
    }
    releaseA();
    expect(await a).toEqual({ ok: false });
    expect(await b).toEqual({ ok: false });
    expect(waiting, "B never waited for A's lock").toBe(true);
    expect(await db.adminUser.findUniqueOrThrow({ where: { email } })).toMatchObject({
      failedAttempts: 0,
      lockedUntil: new Date(now.getTime() + 15 * MIN),
    });
  });

  it("checks at most five passwords against the account when twelve attempts arrive at once (BSA-M2.1-01)", async () => {
    const fixture = await db.adminUser.update({ where: { email }, data: { failedAttempts: 0, lockedUntil: null } });
    const salt = fixture.passwordHash.split("$")[4];
    const now = new Date();
    scryptCalls.mockClear();
    const results = await Promise.all(Array.from({ length: 12 }, () => attemptLogin(db, { email, password: WRONG, now })));
    expect(results.every((r) => !r.ok)).toBe(true);
    // Every attempt runs one scrypt; only those that reserved an attempt use the account's salt.
    expect(scryptCalls).toHaveBeenCalledTimes(12);
    const againstAccount = scryptCalls.mock.calls.filter(([, s]) => Buffer.from(s as Buffer).toString("hex") === salt);
    expect(againstAccount).toHaveLength(5);
    expect(await db.adminUser.findUniqueOrThrow({ where: { email } })).toMatchObject({
      failedAttempts: 0,
      lockedUntil: new Date(now.getTime() + 15 * MIN),
    });
  });
});

describe("sessions (K6, D8)", { timeout: 60_000 }, () => {
  it("stores only sha256(token), expires after 7 days, renews under 1 day left, and deletes", async () => {
    await rolledBack(async (tx) => {
      const a = await admin(tx);
      const { token, expiresAt } = await createSession(tx, a.id, NOW);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(expiresAt).toEqual(at(7 * DAY));

      const stored = await tx.session.findFirstOrThrow({ where: { adminId: a.id } });
      expect(stored.tokenHash).toBe(sha256(token));
      expect(Object.values(stored).some((v) => String(v instanceof Date ? v.toISOString() : v).includes(token))).toBe(false);
      expect(stored.expiresAt).toEqual(at(7 * DAY));

      const found = { sessionId: stored.id, admin: { id: a.id, email: EMAIL } };
      expect(await findSession(tx, token, NOW)).toEqual(found);
      expect(await findSession(tx, `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`, NOW)).toBeNull();
      expect(await findSession(tx, token, at(7 * DAY))).toBeNull();

      // 1 day + 1 s left, and exactly 1 day left: no renewal.
      expect(await findSession(tx, token, at(6 * DAY - 1000))).toEqual(found);
      expect((await tx.session.findUniqueOrThrow({ where: { id: stored.id } })).expiresAt).toEqual(at(7 * DAY));
      expect(await findSession(tx, token, at(6 * DAY))).toEqual(found);
      expect((await tx.session.findUniqueOrThrow({ where: { id: stored.id } })).expiresAt).toEqual(at(7 * DAY));

      // 23:59:59 left: renewed to now + 7 days.
      const renewAt = at(6 * DAY + 1000);
      expect(await findSession(tx, token, renewAt)).toEqual(found);
      expect((await tx.session.findUniqueOrThrow({ where: { id: stored.id } })).expiresAt).toEqual(new Date(renewAt.getTime() + 7 * DAY));

      // A second session of the same admin leaves the first alone; deleting one leaves the other (TEC-M2.1-02).
      const second = await createSession(tx, a.id, renewAt);
      expect(await findSession(tx, token, renewAt)).toEqual(found);
      await deleteSession(tx, stored.id);
      expect(await tx.session.count({ where: { id: stored.id } })).toBe(0);
      expect(await findSession(tx, second.token, renewAt)).not.toBeNull();
      expect(await tx.session.count({ where: { adminId: a.id } })).toBe(1);
      expect(await findSession(tx, token, renewAt)).toBeNull();
    });
  });
});

describe("resetAdmin (K7, D13)", { timeout: 60_000 }, () => {
  it("creates, then resets the hash, the lock and that admin's sessions only", async () => {
    await rolledBack(async (tx) => {
      const first = "first-pass12"; // 12 characters: the minimum
      expect(await resetAdmin(tx, { email: " New@Admin.TEST ", password: first, now: NOW })).toBe("created");
      const created = await tx.adminUser.findUniqueOrThrow({ where: { email: "new@admin.test" } });
      expect(await verifyPassword(first, created.passwordHash)).toBe(true);

      await tx.adminUser.update({ where: { id: created.id }, data: { failedAttempts: 3, lockedUntil: at(5 * MIN) } });
      await createSession(tx, created.id, NOW);
      await createSession(tx, created.id, NOW);
      const other = await admin(tx, { email: "other@x.test", failedAttempts: 2 });
      await createSession(tx, other.id, NOW);
      const otherBefore = { row: await row(tx, other.id), sessions: await tx.session.findMany({ where: { adminId: other.id } }) };

      const second = "second password 456";
      expect(await resetAdmin(tx, { email: "new@admin.test", password: second, now: at(MIN) })).toBe("reset");
      const reset = await row(tx, created.id);
      expect(await verifyPassword(second, reset.passwordHash)).toBe(true);
      expect(await verifyPassword(first, reset.passwordHash)).toBe(false);
      expect(reset).toMatchObject({ failedAttempts: 0, lockedUntil: null });
      expect(await tx.session.count({ where: { adminId: created.id } })).toBe(0);
      expect({ row: await row(tx, other.id), sessions: await tx.session.findMany({ where: { adminId: other.id } }) }).toEqual(otherBefore);
    });
  });

  it("refuses an 11-character password, an email without @ and one of 255 characters, naming the rule, not the value", async () => {
    await rolledBack(async (tx) => {
      const shortPw = "eleven-char";
      const noAt = "admin.x.test";
      const long = `${"a".repeat(255 - "@x.test".length)}@x.test`;
      expect(long).toHaveLength(255);
      const refusal = async (email: string, password: string) => {
        const err = await resetAdmin(tx, { email, password, now: NOW }).then(
          () => null,
          (e: Error) => e,
        );
        expect(err).toBeInstanceOf(Error);
        expect(err!.message).not.toContain(email.trim());
        expect(err!.message).not.toContain(password);
        return err!.message;
      };
      expect(await refusal("ok@x.test", shortPw)).toMatch(/ADMIN_PASSWORD.*at least 12 characters/);
      expect(await refusal(noAt, "long enough password")).toMatch(/ADMIN_EMAIL.*exactly one @/);
      expect(await refusal(long, "long enough password")).toMatch(/ADMIN_EMAIL.*at most 254 characters/);
      expect(await refusal("a@b@x.test", "long enough password")).toMatch(/ADMIN_EMAIL.*exactly one @/);
      expect(await refusal("ok@x.test", "p".repeat(1025))).toMatch(/ADMIN_PASSWORD.*at most 1024 characters/);
      expect(await tx.adminUser.count({ where: { email: { in: ["ok@x.test", noAt, long] } } })).toBe(0);

      const max = `${"a".repeat(254 - "@x.test".length)}@x.test`;
      expect(await resetAdmin(tx, { email: max, password: "long enough password", now: NOW })).toBe("created");
      expect(await resetAdmin(tx, { email: "max-pw@x.test", password: "p".repeat(1024), now: NOW })).toBe("created");
    });
  });
});

describe("node scripts/create-admin.ts (TEC-M2.1-04, D13)", { timeout: 120_000 }, () => {
  // Fake input only; both runs fail before anything commits.
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, ["scripts/create-admin.ts"], { env: { ...process.env, ...env }, encoding: "utf8" });

  it("a broken rule prints only the rule and exits 1", async () => {
    const email = `fake-${randomUUID()}@two@kagumi.test`;
    const r = run({ ADMIN_EMAIL: email, ADMIN_PASSWORD: "fake password 123" });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("ADMIN_EMAIL must contain exactly one @\n");
  });

  it("any other failure prints only the error's name and code, never the input or the driver message", async () => {
    const email = `fake-${randomUUID()}@kagumi.test`;
    const password = `fake password ${randomUUID()}`;
    const url = new URL(process.env.DATABASE_URL!);
    // The development host, so the guard passes, and a database that doesn't exist, so the query fails. Not a
    // wrong password: failed logins made the proxy slow to open the next run's connections (P2028).
    url.pathname = "/kagumi_missing_db";
    const r = run({ ADMIN_EMAIL: email, ADMIN_PASSWORD: password, DATABASE_URL: url.toString() });
    // Booleans only, so a failure never prints the connection string.
    expect(r.status === 1, "exit code 1").toBe(true);
    expect(r.stdout === "", "nothing on stdout").toBe(true);
    expect(/^create-admin failed: \w+( \w+)?\n$/.test(r.stderr), "one line: name and optional code").toBe(true);
    expect([email, password, url.username, url.hostname].some((v) => r.stderr.includes(v)), "no input or URL part").toBe(false);
    expect(await db.adminUser.count({ where: { email } })).toBe(0);
  });
});

afterAll(() => db.$disconnect());
