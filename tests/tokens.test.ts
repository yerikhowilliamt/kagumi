import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const norm = (value: string) => value.replace(/\s+/g, " ").trim();

// Token rows of design.md §2.1–2.4: | `--name` | `light` | `dark` | …
function specTokens() {
  const md = read("docs/design.md");
  const section = md.slice(md.indexOf("### 2.1 "), md.indexOf("### 2.5 "));
  const rows = [...section.matchAll(/^\| `(--[\w-]+)` \| `([^`]+)` \| `([^`]+)` \|/gm)];
  return rows.map(([, name, light, dark]) => ({ name, light: norm(light), dark: norm(dark) }));
}

const css = read("src/styles/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");

// Declarations of the first rule whose selector is exactly `selector`.
function block(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|[\\s{}])${escaped}\\s*\\{([^{}]*)\\}`));
  if (!match) throw new Error(`no block for ${selector}`);
  const decls = new Map<string, string>();
  for (const decl of match[1].split(";")) {
    const i = decl.indexOf(":");
    if (i === -1) continue;
    decls.set(decl.slice(0, i).trim(), norm(decl.slice(i + 1)));
  }
  return decls;
}

const tokens = specTokens();
const light = block(":root");
const darkMedia = block(':root:not([data-theme="light"])');
const darkAttr = block(':root[data-theme="dark"]');

describe("design tokens (design.md §2.1–2.4)", () => {
  it("reads all 32 token rows from design.md", () => {
    expect(tokens).toHaveLength(32);
  });

  it("dark media block sits inside prefers-color-scheme: dark", () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{/);
  });

  it.each(tokens)("$name has the spec light value on :root", ({ name, light: value }) => {
    expect(light.get(name)).toBe(value);
  });

  it.each(tokens)("$name has the spec dark value in both dark blocks", ({ name, dark: value }) => {
    expect(darkMedia.get(name)).toBe(value);
    expect(darkAttr.get(name)).toBe(value);
  });

  it("both dark blocks are identical", () => {
    expect(Object.fromEntries(darkMedia)).toEqual(Object.fromEntries(darkAttr));
  });

  it("sets color-scheme per theme", () => {
    expect(light.get("color-scheme")).toBe("light");
    expect(darkAttr.get("color-scheme")).toBe("dark");
  });
});

describe("components reference tokens only (design.md §2)", () => {
  const modules = readdirSync(join(root, "src"), { recursive: true, encoding: "utf8" }).filter((f) =>
    f.endsWith(".module.css"),
  );

  it("finds the CSS modules", () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  it.each(modules)("src/%s has no color literal", (file) => {
    const source = read(join("src", file)).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(/i);
  });
});
