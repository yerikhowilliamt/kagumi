// TR-M0.3-02: the seed and tests/db refuse any DATABASE_URL that is not the named development branch.
import { describe, expect, it } from "vitest";
import { assertDevelopmentDatabase } from "../prisma/seed.ts";

const DEV = "ep-dev-1.example.test";
const url = (host: string) => `postgresql://u:p@${host}/db?sslmode=require`;

describe("assertDevelopmentDatabase", () => {
  it("accepts the pooled and the direct URL of the development host", () => {
    expect(() => assertDevelopmentDatabase({ DEV_DATABASE_HOST: DEV, DATABASE_URL: url("ep-dev-1-pooler.example.test") })).not.toThrow();
    expect(() => assertDevelopmentDatabase({ DEV_DATABASE_HOST: DEV, DATABASE_URL: url(DEV) })).not.toThrow();
  });

  it("refuses another host, a missing DEV_DATABASE_HOST and a missing DATABASE_URL", () => {
    expect(() => assertDevelopmentDatabase({ DEV_DATABASE_HOST: DEV, DATABASE_URL: url("ep-prod-1-pooler.example.test") })).toThrow(/refusing/);
    expect(() => assertDevelopmentDatabase({ DATABASE_URL: url(DEV) })).toThrow(/refusing/);
    expect(() => assertDevelopmentDatabase({ DEV_DATABASE_HOST: DEV })).toThrow(/refusing/);
  });
});
