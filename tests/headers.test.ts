import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";

// M5 plan §4.4 (D2), directive by directive: a missing or widened directive fails (K1).
const CSP = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
  "media-src": ["'self'", "blob:", "https://res.cloudinary.com"],
  "font-src": ["'self'"],
  "connect-src": ["'self'", "https://api.cloudinary.com"],
  "frame-ancestors": ["'none'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
};
const OTHERS = {
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
};

async function headersIn(env: string) {
  vi.stubEnv("NODE_ENV", env);
  const rules = await nextConfig.headers!();
  expect(rules.map((rule) => rule.source)).toEqual(["/:path*"]);
  const { "Content-Security-Policy": csp, ...others } = Object.fromEntries(rules[0].headers.map(({ key, value }) => [key, value]));
  const directives = Object.fromEntries(csp.split(";").map((part) => part.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));
  return { directives, others };
}

describe("security headers (D2, M5 plan §4.4)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("production: the CSP has exactly the plan's directives and sources, plus the three other headers", async () => {
    const { directives, others } = await headersIn("production");
    expect(directives).toEqual(CSP);
    expect(others).toEqual(OTHERS);
  });

  it("development: script-src adds 'unsafe-eval' and nothing else changes (C1)", async () => {
    const { directives, others } = await headersIn("development");
    expect(directives).toEqual({ ...CSP, "script-src": [...CSP["script-src"], "'unsafe-eval'"] });
    expect(others).toEqual(OTHERS);
  });
});
