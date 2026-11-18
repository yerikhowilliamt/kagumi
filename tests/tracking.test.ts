// Visitor hash and request headers (milestone plan D3, System Design §4.6 step 3), written from the plan.
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { requestVisitor, visitorHash } from "@/lib/tracking";

const SECRET = "test-secret-not-a-real-value";
const IP = "203.0.113.7";
const UA = "Mozilla/5.0 (Linux; Android 14) kagumi-test";
const at = (iso: string) => new Date(iso);

describe("visitorHash (D3)", () => {
  it("is SHA-256(ip + ua + HMAC-SHA256(secret, WIB date)) as 64 hex characters", () => {
    const now = at("2026-11-20T03:00:00Z"); // 10:00 WIB, 2026-11-20
    const salt = createHmac("sha256", SECRET).update("2026-11-20").digest("hex");
    const expected = createHash("sha256").update(IP + UA + salt).digest("hex");
    const hash = visitorHash({ ip: IP, ua: UA, now, secret: SECRET });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(expected);
  });

  it("is equal across one WIB day and changes at 17:00 UTC (00:00 WIB)", () => {
    const hash = (iso: string) => visitorHash({ ip: IP, ua: UA, now: at(iso), secret: SECRET });
    expect(hash("2026-11-19T17:00:00Z")).toBe(hash("2026-11-20T16:59:59.999Z"));
    expect(hash("2026-11-20T16:59:59.999Z")).not.toBe(hash("2026-11-20T17:00:00Z"));
    expect(hash("2026-11-19T16:59:59.999Z")).not.toBe(hash("2026-11-19T17:00:00Z"));
  });

  it("changes with the IP, the user agent and the secret", () => {
    const now = at("2026-11-20T03:00:00Z");
    const base = visitorHash({ ip: IP, ua: UA, now, secret: SECRET });
    expect(visitorHash({ ip: "203.0.113.8", ua: UA, now, secret: SECRET })).not.toBe(base);
    expect(visitorHash({ ip: IP, ua: `${UA} x`, now, secret: SECRET })).not.toBe(base);
    expect(visitorHash({ ip: IP, ua: UA, now, secret: `${SECRET}x` })).not.toBe(base);
  });

  it("never contains the IP, neither in the hash nor in the rate-limit key", () => {
    for (const ip of [IP, "2001:db8::1", "1234"]) {
      const hash = visitorHash({ ip, ua: UA, now: at("2026-11-20T03:00:00Z"), secret: SECRET });
      expect(hash).not.toContain(ip);
      expect(`checkout:${hash}`).not.toContain(ip);
      expect(`checkout:${hash}`.length).toBe(73);
    }
  });

  it("throws when the secret is missing or empty (no silent skip of the rate limit)", () => {
    const now = at("2026-11-20T03:00:00Z");
    expect(() => visitorHash({ ip: IP, ua: UA, now, secret: undefined })).toThrow();
    expect(() => visitorHash({ ip: IP, ua: UA, now, secret: "" })).toThrow();
  });
});

describe("requestVisitor (D3)", () => {
  it("takes the first x-forwarded-for entry, trimmed", () => {
    const headers = new Headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1", "x-real-ip": "198.51.100.1", "user-agent": UA });
    expect(requestVisitor(headers)).toEqual({ ip: IP, ua: UA });
  });

  it("falls back to x-real-ip, then to empty strings", () => {
    expect(requestVisitor(new Headers({ "x-real-ip": " 198.51.100.1 " }))).toEqual({ ip: "198.51.100.1", ua: "" });
    expect(requestVisitor(new Headers({ "x-forwarded-for": "", "x-real-ip": "198.51.100.1" }))).toEqual({ ip: "198.51.100.1", ua: "" });
    expect(requestVisitor(new Headers())).toEqual({ ip: "", ua: "" });
  });
});
