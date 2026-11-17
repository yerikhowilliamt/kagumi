import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import playwrightConfig from "../playwright.config";

// TD-001: config values that lint, typecheck, build and the e2e run would not miss if they changed.
describe("required config values (TD-001)", () => {
  const { compilerOptions } = JSON.parse(readFileSync(join(import.meta.dirname, "../tsconfig.json"), "utf8"));

  it("tsconfig.json is strict", () => {
    expect(compilerOptions.strict).toBe(true);
  });

  it("tsconfig.json maps @/* to ./src/*", () => {
    expect(compilerOptions.paths["@/*"]).toEqual(["./src/*"]);
  });

  it("Vitest runs in the node environment", () => {
    expect(typeof window).toBe("undefined");
  });

  it("Playwright has a project 360 px wide", () => {
    expect(playwrightConfig.projects?.map((project) => project.use?.viewport?.width)).toContain(360);
  });
});
